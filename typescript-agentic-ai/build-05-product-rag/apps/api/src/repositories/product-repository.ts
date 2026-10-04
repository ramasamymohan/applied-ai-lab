/**
 * Product repository — PostgreSQL access for the `products` table.
 *
 * All SQL is parameterized. Filters are applied in SQL, never in application
 * memory, so the same shape can be reused by vector search in a later commit.
 *
 * Price is selected as float8 so callers receive a number. NUMERIC(10,2) is
 * exact in storage and in SQL comparisons; the cast only affects what the
 * driver returns.
 */

import type { Pool } from "pg";
import type { ProductRow, ProductStockStatus } from "../db/types.js";

export type ProductFilter = {
  /** Case-insensitive exact match on category. */
  category?: string | undefined;
  /** Inclusive upper bound on price. */
  maxPrice?: number | undefined;
  /** Currency of maxPrice; products in other currencies are excluded. */
  currency?: string | undefined;
  /** Restrict to these stock statuses. Empty or omitted means any. */
  stockStatuses?: ProductStockStatus[] | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

export type ProductRepository = {
  /** Returns null when the ID is unknown or is not a valid UUID. */
  findById(id: string): Promise<ProductRow | null>;

  /**
   * Returns the products that exist, in the order requested, without
   * duplicates. Unknown IDs and strings that are not UUIDs are skipped, so
   * IDs that came from a model can be passed straight in.
   */
  findByIds(ids: string[]): Promise<ProductRow[]>;

  /** Filtered, deterministically ordered list (name, then id). */
  list(filter?: ProductFilter): Promise<ProductRow[]>;
};

export const DEFAULT_PRODUCT_LIST_LIMIT = 20;
export const MAX_PRODUCT_LIST_LIMIT = 100;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRODUCT_COLUMNS = `
  id, sku, name, brand, category, description, attributes,
  price::float8 AS price, currency, stock_status, image_placeholder,
  created_at, updated_at
`;

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function createProductRepository(pool: Pool): ProductRepository {
  return {
    async findById(id: string): Promise<ProductRow | null> {
      if (!UUID_PATTERN.test(id)) {
        return null;
      }

      const result = await pool.query<ProductRow>(
        `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1`,
        [id],
      );

      return result.rows[0] ?? null;
    },

    async findByIds(ids: string[]): Promise<ProductRow[]> {
      const validIds = [...new Set(ids.filter((id) => UUID_PATTERN.test(id)))];

      if (validIds.length === 0) {
        return [];
      }

      const result = await pool.query<ProductRow>(
        `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = ANY($1::uuid[])`,
        [validIds],
      );

      const byId = new Map(result.rows.map((row) => [row.id, row]));

      // Postgres returns UUIDs lower-case; match requested IDs the same way.
      return validIds.flatMap((id) => {
        const row = byId.get(id.toLowerCase());
        return row ? [row] : [];
      });
    },

    async list(filter: ProductFilter = {}): Promise<ProductRow[]> {
      const conditions: string[] = [];
      const params: unknown[] = [];

      const addParam = (value: unknown): string => {
        params.push(value);
        return `$${params.length}`;
      };

      if (filter.category !== undefined) {
        conditions.push(`lower(category) = lower(${addParam(filter.category)})`);
      }

      if (filter.maxPrice !== undefined) {
        conditions.push(`price <= ${addParam(filter.maxPrice)}::numeric`);
      }

      if (filter.currency !== undefined) {
        conditions.push(`currency = ${addParam(filter.currency)}`);
      }

      if (filter.stockStatuses !== undefined && filter.stockStatuses.length > 0) {
        conditions.push(
          `stock_status = ANY(${addParam(filter.stockStatuses)}::product_stock_status[])`,
        );
      }

      const limit = clampInteger(
        filter.limit,
        DEFAULT_PRODUCT_LIST_LIMIT,
        1,
        MAX_PRODUCT_LIST_LIMIT,
      );
      const offset = clampInteger(filter.offset, 0, 0, Number.MAX_SAFE_INTEGER);

      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const result = await pool.query<ProductRow>(
        `SELECT ${PRODUCT_COLUMNS}
         FROM products
         ${where}
         ORDER BY name ASC, id ASC
         LIMIT ${addParam(limit)} OFFSET ${addParam(offset)}`,
        params,
      );

      return result.rows;
    },
  };
}
