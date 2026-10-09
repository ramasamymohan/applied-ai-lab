/**
 * Product vector search (Build 05).
 *
 * One SQL statement does the whole job: cosine-distance ranking over
 * `product_embeddings`, metadata filters, a similarity floor, and a limit.
 * Filters are applied in SQL, never in application memory.
 *
 * Distance and similarity: pgvector's `<=>` is cosine distance (0 = identical
 * direction, 2 = opposite). Similarity here is `1 - distance`.
 *
 * Only embeddings whose model and dimensions match the query are searched.
 * Vectors from different models are not comparable, so a stale row from an
 * earlier model is invisible to search rather than silently mis-ranked.
 *
 * Caveat for larger catalogs: with an HNSW index, pgvector applies WHERE
 * filters after the index scan, so a selective filter can return fewer than
 * `topK` rows even when more matches exist. At this catalog size the planner
 * is expected to scan exactly, which avoids the problem; this has not been
 * checked with EXPLAIN against a running database.
 */

import type { Pool } from "pg";
import type { ProductRow, ProductStockStatus } from "../db/types.js";

export type VectorSearchFilter = {
  /** Case-insensitive exact match on category. */
  category?: string | undefined;
  /** Inclusive upper bound on price. */
  maxPrice?: number | undefined;
  currency?: string | undefined;
  stockStatuses?: ProductStockStatus[] | undefined;
};

export type VectorSearchParams = {
  vector: number[];
  model: string;
  dimensions: number;
  topK: number;
  /** Cosine similarity floor in [0, 1]. Rows below it are not returned. */
  minSimilarity: number;
  filter: VectorSearchFilter;
};

export type VectorSearchHit = {
  product: ProductRow;
  similarity: number;
};

export type ProductSearchRepository = {
  search(params: VectorSearchParams): Promise<VectorSearchHit[]>;

  /** True if any embedding exists for this model and dimension. */
  hasEmbeddings(model: string, dimensions: number): Promise<boolean>;
};

type SearchRow = ProductRow & { similarity: number };

const PRODUCT_COLUMNS = `
  p.id, p.sku, p.name, p.brand, p.category, p.description, p.attributes,
  p.price::float8 AS price, p.currency, p.stock_status, p.image_placeholder,
  p.created_at, p.updated_at
`;

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export function createProductSearchRepository(
  pool: Pool,
): ProductSearchRepository {
  return {
    async search(params) {
      const queryParams: unknown[] = [];
      const addParam = (value: unknown): string => {
        queryParams.push(value);
        return `$${queryParams.length}`;
      };

      const vector = addParam(toVectorLiteral(params.vector));
      const distance = `(e.embedding <=> ${vector}::vector)`;

      const conditions: string[] = [
        `e.model = ${addParam(params.model)}`,
        `e.dimensions = ${addParam(params.dimensions)}`,
        `${distance} <= ${addParam(1 - params.minSimilarity)}::float8`,
      ];

      const { filter } = params;

      if (filter.category !== undefined) {
        conditions.push(`lower(p.category) = lower(${addParam(filter.category)})`);
      }
      if (filter.maxPrice !== undefined) {
        conditions.push(`p.price <= ${addParam(filter.maxPrice)}::numeric`);
      }
      if (filter.currency !== undefined) {
        conditions.push(`p.currency = ${addParam(filter.currency)}`);
      }
      if (filter.stockStatuses !== undefined && filter.stockStatuses.length > 0) {
        conditions.push(
          `p.stock_status = ANY(${addParam(filter.stockStatuses)}::product_stock_status[])`,
        );
      }

      const limit = Math.max(1, Math.trunc(params.topK));

      // ORDER BY repeats the bare distance expression so an HNSW index can be
      // used; p.id makes ties deterministic.
      const result = await pool.query<SearchRow>(
        `SELECT ${PRODUCT_COLUMNS},
                (1 - ${distance})::float8 AS similarity
           FROM product_embeddings e
           JOIN products p ON p.id = e.product_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY e.embedding <=> ${vector}::vector ASC, p.id ASC
          LIMIT ${addParam(limit)}`,
        queryParams,
      );

      return result.rows.map(({ similarity, ...product }) => ({
        product: product as ProductRow,
        similarity,
      }));
    },

    async hasEmbeddings(model, dimensions) {
      const result = await pool.query<{ found: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM product_embeddings WHERE model = $1 AND dimensions = $2
         ) AS found`,
        [model, dimensions],
      );
      return result.rows[0]?.found === true;
    },
  };
}
