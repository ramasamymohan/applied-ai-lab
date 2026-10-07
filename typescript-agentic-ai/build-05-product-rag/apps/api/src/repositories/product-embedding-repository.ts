/**
 * Product embedding repository (Build 05).
 *
 * Reads what ingestion needs to decide what is stale, and upserts vectors.
 * All SQL is parameterized. Vectors are sent as pgvector text literals
 * ("[0.1,0.2,...]") and cast with ::vector, which avoids a driver-specific
 * pgvector adapter.
 */

import type { Pool } from "pg";

/** A product joined with the state of its stored embedding, if any. */
export type IngestionCandidate = {
  productId: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  attributes: Record<string, unknown>;
  /** Null when the product has no embedding yet. */
  embedding: {
    model: string;
    dimensions: number;
    contentHash: string;
  } | null;
};

export type EmbeddingUpsert = {
  productId: string;
  model: string;
  dimensions: number;
  contentHash: string;
  vector: number[];
};

export type ProductEmbeddingRepository = {
  /**
   * Dimension declared by the embedding column, or null if it cannot be
   * determined. Throws if product_embeddings does not exist.
   */
  getColumnDimensions(): Promise<number | null>;

  /** Every product, ordered by SKU, with its embedding state. */
  listIngestionCandidates(): Promise<IngestionCandidate[]>;

  /** Writes all rows in one transaction: either every row lands or none. */
  upsertMany(rows: EmbeddingUpsert[]): Promise<void>;
};

type CandidateRow = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  attributes: Record<string, unknown>;
  model: string | null;
  dimensions: number | null;
  content_hash: string | null;
};

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export function createProductEmbeddingRepository(
  pool: Pool,
): ProductEmbeddingRepository {
  return {
    async getColumnDimensions() {
      // For pgvector, a column declared vector(N) stores N as its type
      // modifier. -1 means no dimension was declared.
      const result = await pool.query<{ atttypmod: number }>(
        `SELECT atttypmod
           FROM pg_attribute
          WHERE attrelid = 'product_embeddings'::regclass
            AND attname = 'embedding'`,
      );
      const typmod = result.rows[0]?.atttypmod;
      return typeof typmod === "number" && typmod > 0 ? typmod : null;
    },

    async listIngestionCandidates() {
      const result = await pool.query<CandidateRow>(
        `SELECT p.id, p.sku, p.name, p.brand, p.category, p.description,
                p.attributes,
                e.model, e.dimensions, e.content_hash
           FROM products p
           LEFT JOIN product_embeddings e ON e.product_id = p.id
          ORDER BY p.sku ASC`,
      );

      return result.rows.map((row) => ({
        productId: row.id,
        sku: row.sku,
        name: row.name,
        brand: row.brand,
        category: row.category,
        description: row.description,
        attributes: row.attributes,
        embedding:
          row.model !== null &&
          row.dimensions !== null &&
          row.content_hash !== null
            ? {
                model: row.model,
                dimensions: row.dimensions,
                contentHash: row.content_hash,
              }
            : null,
      }));
    },

    async upsertMany(rows) {
      if (rows.length === 0) {
        return;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const row of rows) {
          await client.query(
            `INSERT INTO product_embeddings
               (product_id, model, dimensions, content_hash, embedding)
             VALUES ($1, $2, $3, $4, $5::vector)
             ON CONFLICT (product_id) DO UPDATE SET
               model = EXCLUDED.model,
               dimensions = EXCLUDED.dimensions,
               content_hash = EXCLUDED.content_hash,
               embedding = EXCLUDED.embedding,
               updated_at = now()`,
            [
              row.productId,
              row.model,
              row.dimensions,
              row.contentHash,
              toVectorLiteral(row.vector),
            ],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
