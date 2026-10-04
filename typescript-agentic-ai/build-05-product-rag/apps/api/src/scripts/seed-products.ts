/**
 * Seed the product catalog.
 *
 *   pnpm seed:products             # upsert the seed catalog into PostgreSQL
 *   pnpm seed:products -- --dry-run  # validate the seed data only; no database
 *
 * Behaviour:
 * - Reads DATABASE_URL only. It deliberately does not load the full app
 *   config, so seeding never requires OPENAI_API_KEY.
 * - Upserts by SKU inside one transaction, so a failure leaves the catalog
 *   untouched. Re-running is safe: unchanged rows are not rewritten and their
 *   updated_at stays as it was.
 * - Never deletes. A SKU removed from the seed file stays in the database.
 */

import "dotenv/config";
import pg from "pg";
import { z } from "zod";
import { PRODUCT_SEED, PRODUCT_SEED_VERSION } from "../seed/product-seed-data.js";
import type { ProductSeed } from "../seed/product-seed-data.js";

const seedRowSchema = z.object({
  sku: z.string().min(1).regex(/^[A-Z0-9]+(-[A-Z0-9]+)+$/),
  name: z.string().min(1),
  brand: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()),
  price: z.number().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  stockStatus: z.enum(["in_stock", "low_stock", "out_of_stock"]),
  imagePlaceholder: z.string().min(1),
});

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
});

type SeedReport = { inserted: number; updated: number; unchanged: number };

function validateSeed(rows: ProductSeed[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const parsed = seedRowSchema.safeParse(row);
    if (!parsed.success) {
      throw new Error(
        `Invalid seed row ${row.sku || "(no sku)"}: ${parsed.error.issues
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}`,
      );
    }
    if (seen.has(row.sku)) {
      throw new Error(`Duplicate SKU in seed data: ${row.sku}`);
    }
    seen.add(row.sku);
  }
}

function summarize(rows: ProductSeed[]): string[] {
  const byCategory = new Map<string, number>();
  for (const row of rows) {
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + 1);
  }
  return [...byCategory.entries()].map(([name, count]) => `  ${name}: ${count}`);
}

// IS DISTINCT FROM keeps re-runs from touching rows whose content is
// unchanged. xmax = 0 is true only for a freshly inserted row version; it is
// a PostgreSQL implementation detail but is the usual way to tell insert from
// update in a single upsert.
const UPSERT_SQL = `
  INSERT INTO products
    (sku, name, brand, category, description, attributes,
     price, currency, stock_status, image_placeholder)
  VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::numeric, $8, $9::product_stock_status, $10)
  ON CONFLICT (sku) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    attributes = EXCLUDED.attributes,
    price = EXCLUDED.price,
    currency = EXCLUDED.currency,
    stock_status = EXCLUDED.stock_status,
    image_placeholder = EXCLUDED.image_placeholder,
    updated_at = now()
  WHERE (products.name, products.brand, products.category, products.description,
         products.attributes, products.price, products.currency,
         products.stock_status, products.image_placeholder)
    IS DISTINCT FROM
        (EXCLUDED.name, EXCLUDED.brand, EXCLUDED.category, EXCLUDED.description,
         EXCLUDED.attributes, EXCLUDED.price, EXCLUDED.currency,
         EXCLUDED.stock_status, EXCLUDED.image_placeholder)
  RETURNING (xmax = 0) AS inserted
`;

async function seed(pool: pg.Pool, rows: ProductSeed[]): Promise<SeedReport> {
  const report: SeedReport = { inserted: 0, updated: 0, unchanged: 0 };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      const result = await client.query<{ inserted: boolean }>(UPSERT_SQL, [
        row.sku,
        row.name,
        row.brand,
        row.category,
        row.description,
        JSON.stringify(row.attributes),
        row.price,
        row.currency,
        row.stockStatus,
        row.imagePlaceholder,
      ]);
      // No RETURNING row means the WHERE clause skipped an unchanged row.
      const returned = result.rows[0];
      if (!returned) report.unchanged += 1;
      else if (returned.inserted) report.inserted += 1;
      else report.updated += 1;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return report;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  validateSeed(PRODUCT_SEED);
  console.log(
    `Seed v${PRODUCT_SEED_VERSION}: ${PRODUCT_SEED.length} products, all rows valid, SKUs unique.`,
  );
  for (const line of summarize(PRODUCT_SEED)) console.log(line);

  if (dryRun) {
    console.log("Dry run: no database changes made.");
    return;
  }

  const env = envSchema.safeParse(process.env);
  if (!env.success) {
    throw new Error(env.error.issues.map((i) => i.message).join("; "));
  }

  const pool = new pg.Pool({
    connectionString: env.data.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    const report = await seed(pool, PRODUCT_SEED);
    console.log(
      `Seeded: ${report.inserted} inserted, ${report.updated} updated, ${report.unchanged} unchanged.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Seed failed: ${message}`);
  if (/relation "products" does not exist|type "product_stock_status"/.test(message)) {
    console.error("Run the catalog migrations first: pnpm migrate:catalog");
  }
  process.exitCode = 1;
});
