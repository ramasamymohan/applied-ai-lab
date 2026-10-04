/**
 * OpenAI Responses API adapter for structured generation (Build 04).
 *
 * Isolates provider specifics: strict JSON Schema output format, refusal and
 * incomplete detection, and error classification. Nothing outside this file
 * imports OpenAI types for structured calls.
 *
 * The SDK's Zod helper is deliberately not used. The contract already derives
 * its JSON Schema from Zod (see contract.ts), and parsing/validation is done
 * by the service so that every failure class stays visible and distinct.
 *
 * The structured step is non-streaming. It uses a limited SDK retry
 * (maxRetries: 1) for transport-level errors: unlike the streaming path there
 * is no partial output to duplicate.
 *
 * API shapes below are written from prior knowledge of the Responses API and
 * must be verified against the installed `openai` version.
 */

import OpenAI from "openai";
import type {
  ProviderErrorKind,
  ProviderGenerateOptions,
  RawModelOutcome,
  StructuredModelProvider,
} from "./types.js";

export type CreateOpenAIStructuredProviderOptions = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  /** Receives sanitized failure metadata only (never messages or payloads). */
  logger?: { warn: (details: object, message: string) => void } | undefined;
};

function classifyError(
  err: unknown,
  signal: AbortSignal | undefined,
): ProviderErrorKind {
  if (signal?.aborted || err instanceof OpenAI.APIUserAbortError) {
    return "aborted";
  }

  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return "timeout";
  }

  if (err instanceof OpenAI.RateLimitError) {
    return "rate_limited";
  }

  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    if (typeof status === "number" && status >= 500) {
      return "unavailable";
    }
  }

  if (err instanceof OpenAI.APIConnectionError) {
    return "unavailable";
  }

  return "unknown";
}

function findRefusal(output: unknown): string | null {
  if (!Array.isArray(output)) {
    return null;
  }

  for (const item of output) {
    if (
      typeof item !== "object" ||
      item === null ||
      (item as { type?: unknown }).type !== "message"
    ) {
      continue;
    }

    const content = (item as { content?: unknown }).content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "refusal"
      ) {
        const refusal = (part as { refusal?: unknown }).refusal;
        return typeof refusal === "string" ? refusal : "The model refused.";
      }
    }
  }

  return null;
}

export function createOpenAIStructuredProvider(
  options: CreateOpenAIStructuredProviderOptions,
): StructuredModelProvider {
  const client = new OpenAI({
    apiKey: options.apiKey,
    timeout: options.timeoutMs,
    maxRetries: 1,
  });

  return {
    async generate(
      generateOptions: ProviderGenerateOptions,
    ): Promise<RawModelOutcome> {
      const { instructions, input, schemaName, jsonSchema, signal } =
        generateOptions;

      try {
        const response = await client.responses.create(
          {
            model: options.model,
            instructions,
            input,
            max_output_tokens: options.maxOutputTokens,
            text: {
              format: {
                type: "json_schema",
                name: schemaName,
                schema: jsonSchema,
                strict: true,
              },
            },
          },
          { signal },
        );

        // Truncated output is never trusted, even if it happens to parse.
        if (response.status === "incomplete") {
          return {
            kind: "incomplete",
            reason: response.incomplete_details?.reason ?? "unknown",
          };
        }

        if (response.status === "failed") {
          options.logger?.warn(
            { code: response.error?.code ?? null },
            "Structured generation: provider reported a failed response",
          );
          return { kind: "provider_error", errorKind: "unknown" };
        }

        const refusal = findRefusal(response.output);

        if (refusal !== null) {
          return { kind: "refusal", message: refusal };
        }

        return { kind: "text", text: response.output_text };
      } catch (err) {
        const errorKind = classifyError(err, signal);

        if (errorKind !== "aborted") {
          options.logger?.warn(
            {
              errorKind,
              status:
                err instanceof OpenAI.APIError ? (err.status ?? null) : null,
              code: err instanceof OpenAI.APIError ? (err.code ?? null) : null,
            },
            "Structured generation: provider call failed",
          );
        }

        return { kind: "provider_error", errorKind };
      }
    },
  };
}
