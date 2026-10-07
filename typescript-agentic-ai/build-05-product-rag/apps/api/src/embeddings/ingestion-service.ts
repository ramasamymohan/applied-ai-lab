/**
 * Product embedding ingestion (Build 05).
 *
 * Idempotent by construction: a product is (re)embedded only when its
 * embedding is missing, its content hash changed, the model or dimensions
 * differ from the configured ones, or `force` is set. Running it twice in a
 * row embeds nothing the second time.
 *
 * Failure behaviour:
 *  - A dimension mismatch (configured vs. column, or provider vs. configured)
 *    is fatal. It stops the run, because every remaining batch would fail the
 *    same way and cost money doing so.
 *  - Other batch failures (timeout, rate limit, ...) are recorded per product
 *    and the run continues. Each successful batch is written before the next
 *    starts, so progress survives a crash; re-running picks up what is left.
 *  - Failure reasons are sanitized category names. Product text, vectors and
 *    provider messages are never logged.
 */

import type { EmbeddingService } from "./types.js";
import {
  composeProductEmbeddingText,
  hashEmbeddingText,
} from "./product-embedding-text.js";
import type {
  EmbeddingUpsert,
  IngestionCandidate,
  ProductEmbeddingRepository,
} from "../repositories/product-embedding-repository.js";

export type IngestionFailure = { sku: string; reason: string };

export type IngestionReport = {
  /** Products in the catalog. */
  total: number;
  /** Already up to date; not sent to the provider. */
  skipped: number;
  /** Needed (re)embedding at the start of the run. */
  pending: number;
  /** Embedded and stored this run. Always 0 for a dry run. */
  embedded: number;
  /** Attempted but failed. */
  failed: number;
  /** Pending but never attempted because the run stopped early. */
  notAttempted: number;
  failures: IngestionFailure[];
  /** Set when the run stopped early (dimension mismatch, interruption). */
  fatal: string | null;
  dryRun: boolean;
};

export type IngestionOptions = {
  repository: ProductEmbeddingRepository;
  embeddings: EmbeddingService;
  batchSize: number;
  /** Re-embed every product regardless of hash. */
  force?: boolean | undefined;
  /** Compute the plan only: no provider calls, no writes. */
  dryRun?: boolean | undefined;
  signal?: AbortSignal | undefined;
  /** Progress lines. Must never receive product text or vectors. */
  log?: ((message: string) => void) | undefined;
};

type PendingItem = { candidate: IngestionCandidate; text: string; hash: string };

function isUpToDate(
  candidate: IngestionCandidate,
  hash: string,
  model: string,
  dimensions: number,
): boolean {
  const stored = candidate.embedding;
  return (
    stored !== null &&
    stored.contentHash === hash &&
    stored.model === model &&
    stored.dimensions === dimensions
  );
}

export async function ingestProductEmbeddings(
  options: IngestionOptions,
): Promise<IngestionReport> {
  const { repository, embeddings, batchSize, signal } = options;
  const log = options.log ?? (() => undefined);
  const dryRun = options.dryRun === true;
  const force = options.force === true;

  // Fail before spending anything if the column cannot hold our vectors.
  const columnDimensions = await repository.getColumnDimensions();
  if (columnDimensions !== null && columnDimensions !== embeddings.dimensions) {
    throw new Error(
      `Dimension mismatch: EMBEDDING_DIMENSIONS is ${embeddings.dimensions} but ` +
        `product_embeddings.embedding is vector(${columnDimensions}). ` +
        `Set EMBEDDING_DIMENSIONS=${columnDimensions}, or add a migration that ` +
        `changes the column and re-embed every product.`,
    );
  }

  const candidates = await repository.listIngestionCandidates();
  const pending: PendingItem[] = [];
  let skipped = 0;

  for (const candidate of candidates) {
    const text = composeProductEmbeddingText(candidate);
    const hash = hashEmbeddingText(text);
    if (
      !force &&
      isUpToDate(candidate, hash, embeddings.model, embeddings.dimensions)
    ) {
      skipped += 1;
    } else {
      pending.push({ candidate, text, hash });
    }
  }

  const report: IngestionReport = {
    total: candidates.length,
    skipped,
    pending: pending.length,
    embedded: 0,
    failed: 0,
    notAttempted: 0,
    failures: [],
    fatal: null,
    dryRun,
  };

  if (dryRun || pending.length === 0) {
    return report;
  }

  for (let start = 0; start < pending.length; start += batchSize) {
    if (signal?.aborted) {
      report.fatal = "interrupted";
      report.notAttempted = pending.length - start;
      break;
    }

    const batch = pending.slice(start, start + batchSize);
    const result = await embeddings.embedTexts(
      batch.map((item) => item.text),
      { signal },
    );

    if (!result.ok) {
      if (result.kind === "dimension_mismatch") {
        report.fatal =
          `dimension_mismatch: provider returned ${result.receivedDimensions ?? "unknown"}-dimension ` +
          `vectors but EMBEDDING_DIMENSIONS is ${embeddings.dimensions}`;
        report.failed += batch.length;
        for (const item of batch) {
          report.failures.push({ sku: item.candidate.sku, reason: result.kind });
        }
        report.notAttempted = pending.length - start - batch.length;
        break;
      }

      if (result.kind === "aborted") {
        report.fatal = "interrupted";
        report.notAttempted = pending.length - start;
        break;
      }

      report.failed += batch.length;
      for (const item of batch) {
        report.failures.push({ sku: item.candidate.sku, reason: result.kind });
      }
      log(`Batch of ${batch.length} failed: ${result.kind}`);
      continue;
    }

    const rows: EmbeddingUpsert[] = batch.map((item, index) => ({
      productId: item.candidate.productId,
      model: result.model,
      dimensions: result.dimensions,
      contentHash: item.hash,
      vector: result.vectors[index] as number[],
    }));

    try {
      await repository.upsertMany(rows);
    } catch {
      report.failed += batch.length;
      for (const item of batch) {
        report.failures.push({ sku: item.candidate.sku, reason: "store_failed" });
      }
      log(`Batch of ${batch.length} embedded but could not be stored`);
      continue;
    }

    report.embedded += batch.length;
    log(`Embedded ${report.embedded}/${pending.length}`);
  }

  return report;
}
