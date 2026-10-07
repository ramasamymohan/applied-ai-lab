/**
 * Ingest product embeddings.
 *
 *   pnpm ingest:embeddings              # embed new or changed products
 *   pnpm ingest:embeddings -- --dry-run # show what would be embedded; no provider calls, no writes
 *   pnpm ingest:embeddings -- --force   # re-embed every product
 *
 * Requires the catalog migrations and seed (pnpm migrate:catalog,
 * pnpm seed:products), DATABASE_URL, and OPENAI_API_KEY. The API key stays on
 * the backend; this script is never bundled into the web app.
 *
 * Exit code is 1 when any product failed or the run stopped early, so a
 * wrapper script or CI step can detect a partial ingestion.
 */

import pg from "pg";
import { config } from "../config.js";
import { createEmbeddingService } from "../embeddings/embedding-service.js";
import {
  ingestProductEmbeddings,
  type IngestionReport,
} from "../embeddings/ingestion-service.js";
import { createOpenAIEmbeddingProvider } from "../embeddings/openai-embedding-provider.js";
import { createProductEmbeddingRepository } from "../repositories/product-embedding-repository.js";

function printReport(report: IngestionReport): void {
  const heading = report.dryRun ? "Dry run (nothing sent, nothing written)" : "Ingestion";
  console.log(`\n${heading}`);
  console.log(`  products:      ${report.total}`);
  console.log(`  skipped:       ${report.skipped} (already up to date)`);
  if (report.dryRun) {
    console.log(`  would embed:   ${report.pending}`);
    return;
  }
  console.log(`  embedded:      ${report.embedded}`);
  console.log(`  failed:        ${report.failed}`);
  if (report.notAttempted > 0) {
    console.log(`  not attempted: ${report.notAttempted}`);
  }
  for (const failure of report.failures) {
    console.log(`    ${failure.sku}: ${failure.reason}`);
  }
  if (report.fatal) {
    console.log(`  stopped early: ${report.fatal}`);
  }
}

async function main(): Promise<number> {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");

  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5_000,
  });

  const abort = new AbortController();
  process.once("SIGINT", () => {
    console.log("\nInterrupted; finishing the current step...");
    abort.abort();
  });

  try {
    const embeddings = createEmbeddingService({
      provider: createOpenAIEmbeddingProvider({
        apiKey: config.OPENAI_API_KEY,
        model: config.EMBEDDING_MODEL,
        dimensions: config.EMBEDDING_DIMENSIONS,
        timeoutMs: config.EMBEDDING_TIMEOUT_MS,
        logger: { warn: (details, message) => console.warn(message, details) },
      }),
      model: config.EMBEDDING_MODEL,
      dimensions: config.EMBEDDING_DIMENSIONS,
    });

    console.log(
      `Model ${embeddings.model}, ${embeddings.dimensions} dimensions, batch size ${config.EMBEDDING_BATCH_SIZE}` +
        (force ? ", force" : "") +
        (dryRun ? ", dry run" : ""),
    );

    const report = await ingestProductEmbeddings({
      repository: createProductEmbeddingRepository(pool),
      embeddings,
      batchSize: config.EMBEDDING_BATCH_SIZE,
      force,
      dryRun,
      signal: abort.signal,
      log: (message) => console.log(`  ${message}`),
    });

    printReport(report);
    return report.failed > 0 || report.fatal !== null ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Ingestion failed: ${message}`);
    if (/relation "(products|product_embeddings)" does not exist/.test(message)) {
      console.error(
        "Run the catalog migrations and seed first: pnpm migrate:catalog && pnpm seed:products",
      );
    }
    process.exitCode = 1;
  });
