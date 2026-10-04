/**
 * Shared types for the structured generation layer (Build 04).
 *
 * Two boundaries live here:
 *
 *  1. StructuredModelProvider — the provider port. An adapter (OpenAI today)
 *     turns one model call into a RawModelOutcome. It never throws and never
 *     leaks provider SDK types.
 *  2. StructuredResult — what the application sees. A discriminated union, so
 *     callers must handle every failure class explicitly.
 */

// ── Model input ───────────────────────────────────────────────────────────────

export type ModelInputMessage = {
  role: "user" | "assistant";
  content: string;
};

// ── Provider port ─────────────────────────────────────────────────────────────

/** Sanitized provider failure categories. Never contains provider messages. */
export type ProviderErrorKind =
  | "timeout"
  | "aborted"
  | "rate_limited"
  | "unavailable"
  | "unknown";

export type RawModelOutcome =
  /** The model produced text (expected to be JSON). Not yet trusted. */
  | { kind: "text"; text: string }
  /** The model declined to produce the structured output. */
  | { kind: "refusal"; message: string }
  /** Generation stopped early (token limit, content filter). Output is unusable. */
  | { kind: "incomplete"; reason: string }
  /** The call failed. */
  | { kind: "provider_error"; errorKind: ProviderErrorKind };

export type ProviderGenerateOptions = {
  instructions: string;
  input: ModelInputMessage[];
  /** Name sent to the provider with the JSON Schema. */
  schemaName: string;
  /** Strict-mode-compatible JSON Schema derived from the Zod contract. */
  jsonSchema: Record<string, unknown>;
  signal?: AbortSignal | undefined;
};

export type StructuredModelProvider = {
  /** Must not throw. Failures are returned as RawModelOutcome values. */
  generate(options: ProviderGenerateOptions): Promise<RawModelOutcome>;
};

// ── Application-facing result ─────────────────────────────────────────────────

type ResultMeta = {
  /** Contract identity, so callers can persist name + version with the data. */
  contract: { name: string; version: number };
  /** Number of provider calls made (1, or 2 after a repair retry). */
  attempts: number;
  /** Wall-clock time across all attempts. Added latency is measured, not hidden. */
  latencyMs: number;
};

export type StructuredOk<T> = ResultMeta & {
  status: "ok";
  data: T;
  /** True when the first attempt failed validation and the repair retry succeeded. */
  repaired: boolean;
};

export type StructuredRefusal = ResultMeta & {
  status: "refusal";
  /** Provider-supplied refusal text. Treat as untrusted; do not show verbatim to users. */
  message: string;
};

export type StructuredIncomplete = ResultMeta & {
  status: "incomplete";
  reason: string;
};

export type StructuredInvalid = ResultMeta & {
  status: "invalid";
  failure: "json_parse" | "schema_validation";
  /** Path + message pairs only; never contains model output or user text. */
  issues: string[];
};

export type StructuredProviderError = ResultMeta & {
  status: "provider_error";
  errorKind: ProviderErrorKind;
};

export type StructuredResult<T> =
  | StructuredOk<T>
  | StructuredRefusal
  | StructuredIncomplete
  | StructuredInvalid
  | StructuredProviderError;
