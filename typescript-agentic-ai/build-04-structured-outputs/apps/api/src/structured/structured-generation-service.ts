/**
 * StructuredGenerationService (Build 04).
 *
 * Turns a prompt plus a Zod contract into a validated, typed value — or a
 * named failure. Provider specifics live behind StructuredModelProvider.
 *
 * Failure taxonomy and behavior
 *
 *   provider_error  Call failed (timeout, abort, rate limit, outage).
 *                   Not retried here. The caller decides what to do.
 *   refusal         The model declined. Not retried: asking again rarely
 *                   changes a refusal and can look like probing.
 *   incomplete      Output was cut off (token limit, content filter).
 *                   Not retried: a truncated document cannot be repaired by
 *                   re-prompting within the same limits.
 *   invalid         Text arrived but is not valid JSON (json_parse) or fails
 *                   the Zod contract (schema_validation). These are the only
 *                   failures eligible for the single repair retry.
 *
 * The repair retry happens at most once, and only when enabled. After that the
 * result is `invalid`; there is no loop. The worst case is therefore two
 * provider calls, each bounded by the provider timeout.
 *
 * Provider-enforced schemas are not the application's contract boundary, so
 * every `ok` result has passed contract.schema.safeParse().
 *
 * generate() never throws. Errors are returned as values so callers (the turn
 * lifecycle) cannot forget a failure path.
 */

import type { z } from "zod";
import type { StructuredContract } from "./contract.js";
import type {
  ModelInputMessage,
  RawModelOutcome,
  StructuredModelProvider,
  StructuredResult,
} from "./types.js";

export type StructuredGenerationRequest<S extends z.ZodType> = {
  contract: StructuredContract<S>;
  /** System-level instructions for this task. */
  instructions: string;
  /** Conversation input. Treated as data by the model; not modified here. */
  input: ModelInputMessage[];
  signal?: AbortSignal | undefined;
};

export type StructuredGenerationService = {
  generate<S extends z.ZodType>(
    request: StructuredGenerationRequest<S>,
  ): Promise<StructuredResult<z.output<S>>>;
};

export type CreateStructuredGenerationServiceOptions = {
  provider: StructuredModelProvider;
  /** Allow one repair retry after a parse or validation failure. */
  repairEnabled: boolean;
};

const MAX_ISSUES = 10;
const MAX_ISSUE_LENGTH = 200;
/** Cap on how much of the model's own invalid output is echoed back. */
const MAX_ECHOED_OUTPUT_CHARS = 2_000;

type ValidationFailure = {
  failure: "json_parse" | "schema_validation";
  issues: string[];
};

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/** Parse and validate model text. Issues carry paths and rules, never values. */
function validateText<S extends z.ZodType>(
  text: string,
  contract: StructuredContract<S>,
): { ok: true; data: z.output<S> } | ({ ok: false } & ValidationFailure) {
  if (text.trim().length === 0) {
    return {
      ok: false,
      failure: "json_parse",
      issues: ["(root): output was empty"],
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      failure: "json_parse",
      issues: ["(root): output is not valid JSON"],
    };
  }

  const result = contract.schema.safeParse(parsed);

  if (result.success) {
    return { ok: true, data: result.data as z.output<S> };
  }

  const issues = result.error.issues
    .slice(0, MAX_ISSUES)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return truncate(`${path}: ${issue.message}`, MAX_ISSUE_LENGTH);
    });

  return { ok: false, failure: "schema_validation", issues };
}

function buildRepairInput(
  original: ModelInputMessage[],
  invalidOutput: string,
  failure: ValidationFailure,
): ModelInputMessage[] {
  return [
    ...original,
    {
      role: "assistant",
      content: truncate(invalidOutput, MAX_ECHOED_OUTPUT_CHARS),
    },
    {
      role: "user",
      content:
        "Your previous output was rejected by the application's validator " +
        `(${failure.failure}). Problems:\n` +
        failure.issues.map((issue) => `- ${issue}`).join("\n") +
        "\nReturn a corrected response that satisfies the required schema. " +
        "Output only the corrected JSON.",
    },
  ];
}

export function createStructuredGenerationService(
  options: CreateStructuredGenerationServiceOptions,
): StructuredGenerationService {
  const maxAttempts = options.repairEnabled ? 2 : 1;

  async function callProvider(
    request: StructuredGenerationRequest<z.ZodType>,
    input: ModelInputMessage[],
  ): Promise<RawModelOutcome> {
    try {
      return await options.provider.generate({
        instructions: request.instructions,
        input,
        schemaName: request.contract.name,
        jsonSchema: request.contract.jsonSchema,
        signal: request.signal,
      });
    } catch {
      // The port promises not to throw; this guards against a faulty adapter.
      return { kind: "provider_error", errorKind: "unknown" };
    }
  }

  return {
    async generate<S extends z.ZodType>(
      request: StructuredGenerationRequest<S>,
    ): Promise<StructuredResult<z.output<S>>> {
      const startedAt = performance.now();
      const contract = request.contract;
      let attempts = 0;
      let input = request.input;

      const meta = () => ({
        contract: { name: contract.name, version: contract.version },
        attempts,
        latencyMs: Math.round(performance.now() - startedAt),
      });

      // Bounded by maxAttempts: every path either returns or retries once.
      while (true) {
        if (request.signal?.aborted) {
          return {
            status: "provider_error",
            errorKind: "aborted",
            ...meta(),
          };
        }

        attempts += 1;
        const outcome = await callProvider(request, input);

        switch (outcome.kind) {
          case "provider_error":
            return {
              status: "provider_error",
              errorKind: outcome.errorKind,
              ...meta(),
            };

          case "refusal":
            return { status: "refusal", message: outcome.message, ...meta() };

          case "incomplete":
            return { status: "incomplete", reason: outcome.reason, ...meta() };

          case "text": {
            const validated = validateText(outcome.text, contract);

            if (validated.ok) {
              return {
                status: "ok",
                data: validated.data,
                repaired: attempts > 1,
                ...meta(),
              };
            }

            if (attempts < maxAttempts) {
              input = buildRepairInput(request.input, outcome.text, validated);
              continue;
            }

            return {
              status: "invalid",
              failure: validated.failure,
              issues: validated.issues,
              ...meta(),
            };
          }
        }
      }
    },
  };
}
