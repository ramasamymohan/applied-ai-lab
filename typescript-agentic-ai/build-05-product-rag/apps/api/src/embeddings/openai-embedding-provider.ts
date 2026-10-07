/**
 * OpenAI embeddings adapter (Build 05).
 *
 * Isolates provider specifics: the request shape, response ordering, and error
 * classification. Nothing outside this file imports OpenAI types for
 * embeddings.
 *
 * Embedding calls are idempotent and have no partial output, so the SDK's
 * built-in retry (maxRetries) is safe to use for transport-level failures.
 *
 * The `dimensions` request parameter is supported by the text-embedding-3
 * models. Older models such as text-embedding-ada-002 reject it. The shapes
 * below are written from prior knowledge of the embeddings API and must be
 * verified against the installed `openai` version.
 */

import OpenAI from "openai";
import type {
  EmbeddingProvider,
  EmbeddingProviderErrorKind,
} from "./types.js";

export type CreateOpenAIEmbeddingProviderOptions = {
  apiKey: string;
  model: string;
  /** Requested output dimension (text-embedding-3 models). */
  dimensions: number;
  timeoutMs: number;
  /** Receives sanitized failure metadata only (never texts or vectors). */
  logger?: { warn: (details: object, message: string) => void } | undefined;
};

function classifyError(
  err: unknown,
  signal: AbortSignal | undefined,
): EmbeddingProviderErrorKind {
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

export function createOpenAIEmbeddingProvider(
  options: CreateOpenAIEmbeddingProviderOptions,
): EmbeddingProvider {
  const client = new OpenAI({
    apiKey: options.apiKey,
    timeout: options.timeoutMs,
    maxRetries: 2,
  });

  return {
    async embed(texts, callOptions) {
      const signal = callOptions?.signal;

      try {
        const response = await client.embeddings.create(
          {
            model: options.model,
            input: texts,
            dimensions: options.dimensions,
            encoding_format: "float",
          },
          signal ? { signal } : undefined,
        );

        // The API returns an index per item; do not assume array order.
        const ordered = [...response.data].sort((a, b) => a.index - b.index);

        return {
          ok: true,
          vectors: ordered.map((item) => item.embedding),
          model: options.model,
        };
      } catch (err) {
        const kind = classifyError(err, signal);
        options.logger?.warn(
          {
            kind,
            status: err instanceof OpenAI.APIError ? err.status : undefined,
            batchSize: texts.length,
          },
          "Embedding request failed",
        );
        return { ok: false, kind };
      }
    },
  };
}
