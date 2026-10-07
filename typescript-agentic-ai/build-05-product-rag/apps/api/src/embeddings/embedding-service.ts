/**
 * Embedding service (Build 05).
 *
 * Wraps a provider and enforces the contract the rest of the system relies
 * on, so nothing downstream has to re-check it:
 *
 *  - exactly one vector per input text, in input order
 *  - every vector has exactly `dimensions` finite numbers
 *
 * A provider that returns the wrong length produces `dimension_mismatch`
 * rather than a vector that would later be rejected (or silently mis-compared)
 * by the database. Never throws.
 */

import type {
  EmbeddingProvider,
  EmbeddingService,
  EmbedTextsResult,
} from "./types.js";

export type CreateEmbeddingServiceOptions = {
  provider: EmbeddingProvider;
  /** Model name to record with stored embeddings. */
  model: string;
  /** Required vector length. */
  dimensions: number;
};

export function createEmbeddingService(
  options: CreateEmbeddingServiceOptions,
): EmbeddingService {
  const { provider, model, dimensions } = options;

  return {
    model,
    dimensions,

    async embedTexts(texts, callOptions): Promise<EmbedTextsResult> {
      if (texts.length === 0) {
        return { ok: true, vectors: [], model, dimensions };
      }

      const result = await provider.embed(texts, callOptions);
      if (!result.ok) {
        return { ok: false, kind: result.kind };
      }

      if (result.vectors.length !== texts.length) {
        return { ok: false, kind: "invalid_response" };
      }

      for (const vector of result.vectors) {
        if (!Array.isArray(vector)) {
          return { ok: false, kind: "invalid_response" };
        }
        if (vector.length !== dimensions) {
          return {
            ok: false,
            kind: "dimension_mismatch",
            receivedDimensions: vector.length,
          };
        }
        for (const value of vector) {
          if (typeof value !== "number" || !Number.isFinite(value)) {
            return { ok: false, kind: "invalid_response" };
          }
        }
      }

      return { ok: true, vectors: result.vectors, model, dimensions };
    },
  };
}
