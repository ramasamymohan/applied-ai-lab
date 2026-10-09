/**
 * Product retrieval service (Build 05).
 *
 * Embeds the query with the same model and dimension used for the catalog and
 * runs a filtered vector search. It owns no business rules about *what* to
 * search for; callers pass the query text and filters.
 *
 * Failure model: never throws. A failure is one of:
 *   - embedding_failed:<kind>   the query could not be embedded
 *   - search_failed             the database query failed
 *   - catalog_not_indexed       no embeddings exist for the configured model,
 *                               so "no results" would be misleading
 * "No relevant products" is NOT a failure: it is an ok result with no hits.
 *
 * Retrieved product text is untrusted data. This service returns it as-is and
 * the caller must treat it that way (see grounded-answer-service.ts).
 */

import type { EmbeddingService } from "../embeddings/types.js";
import type {
  ProductSearchRepository,
  VectorSearchFilter,
  VectorSearchHit,
} from "../repositories/product-search-repository.js";

export type RetrievalResult =
  | { status: "ok"; hits: VectorSearchHit[] }
  | { status: "failed"; reason: string };

export type ProductRetrievalService = {
  /** Retrieval parameters in effect, for persistence alongside each turn. */
  readonly params: {
    topK: number;
    minSimilarity: number;
    embeddingModel: string;
  };
  retrieve(options: {
    queryText: string;
    filter: VectorSearchFilter;
    signal?: AbortSignal | undefined;
  }): Promise<RetrievalResult>;
};

export type CreateProductRetrievalServiceOptions = {
  embeddings: EmbeddingService;
  searchRepository: ProductSearchRepository;
  topK: number;
  minSimilarity: number;
  /** Receives sanitized failure metadata only. */
  logger?: { warn: (details: object, message: string) => void } | undefined;
};

export function createProductRetrievalService(
  options: CreateProductRetrievalServiceOptions,
): ProductRetrievalService {
  const { embeddings, searchRepository, topK, minSimilarity, logger } = options;

  return {
    params: { topK, minSimilarity, embeddingModel: embeddings.model },

    async retrieve({ queryText, filter, signal }) {
      const embedded = await embeddings.embedTexts([queryText], { signal });
      if (!embedded.ok) {
        return { status: "failed", reason: `embedding_failed:${embedded.kind}` };
      }

      const vector = embedded.vectors[0];
      if (!vector) {
        return { status: "failed", reason: "embedding_failed:invalid_response" };
      }

      try {
        const hits = await searchRepository.search({
          vector,
          model: embeddings.model,
          dimensions: embeddings.dimensions,
          topK,
          minSimilarity,
          filter,
        });

        if (hits.length === 0) {
          // Zero hits is only meaningful if there is something to search.
          const indexed = await searchRepository.hasEmbeddings(
            embeddings.model,
            embeddings.dimensions,
          );
          if (!indexed) {
            logger?.warn(
              { model: embeddings.model },
              "No product embeddings for the configured model; run pnpm ingest:embeddings",
            );
            return { status: "failed", reason: "catalog_not_indexed" };
          }
        }

        return { status: "ok", hits };
      } catch (err) {
        logger?.warn(
          { errorName: err instanceof Error ? err.name : "unknown" },
          "Product vector search failed",
        );
        return { status: "failed", reason: "search_failed" };
      }
    },
  };
}
