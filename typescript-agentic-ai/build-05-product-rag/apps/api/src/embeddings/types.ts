/**
 * Embedding types (Build 05).
 *
 * Two boundaries, mirroring the structured-generation layer:
 *
 *  1. EmbeddingProvider is the provider port. An adapter (OpenAI today) turns
 *     one batch request into vectors or a sanitized failure. It never throws
 *     and never leaks SDK types or provider error messages.
 *  2. EmbeddingService is what the application uses. It owns the contract the
 *     rest of the system relies on: one finite vector per input, in order,
 *     each exactly `dimensions` long.
 */

/** Sanitized failure categories. Never contains provider messages. */
export type EmbeddingProviderErrorKind =
  | "timeout"
  | "aborted"
  | "rate_limited"
  | "unavailable"
  | "unknown";

export type EmbeddingErrorKind =
  | EmbeddingProviderErrorKind
  /** Wrong number of vectors, or a non-finite value in a vector. */
  | "invalid_response"
  /** The provider returned vectors whose length differs from the configured one. */
  | "dimension_mismatch";

export type EmbeddingProviderResult =
  | { ok: true; vectors: number[][]; model: string }
  | { ok: false; kind: EmbeddingProviderErrorKind };

export type EmbeddingProvider = {
  embed(
    texts: string[],
    options?: { signal?: AbortSignal | undefined },
  ): Promise<EmbeddingProviderResult>;
};

export type EmbedTextsResult =
  | { ok: true; vectors: number[][]; model: string; dimensions: number }
  | {
      ok: false;
      kind: EmbeddingErrorKind;
      /** Set for dimension_mismatch: the length the provider returned. */
      receivedDimensions?: number;
    };

export type EmbeddingService = {
  /** Model name recorded alongside every stored embedding. */
  readonly model: string;
  /** Vector length this service guarantees. */
  readonly dimensions: number;
  /** Never throws. Returns vectors in input order or a classified failure. */
  embedTexts(
    texts: string[],
    options?: { signal?: AbortSignal | undefined },
  ): Promise<EmbedTextsResult>;
};
