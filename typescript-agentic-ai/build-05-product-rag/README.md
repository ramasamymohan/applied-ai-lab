# Build 05 — Product RAG: Grounding Answers in a Real Catalog

Part of the **From Prompt to Platform** series. Each build in this series is a fully independent, standalone application.

> **Status: in progress. Commits 01 and 02 of 04 are implemented.** Lint, type-check, and build results are not recorded here; run the validation commands below. Nothing in this build has been run against a live PostgreSQL/pgvector instance or the embeddings API by the author of these docs.

---

## Objective

Stop the assistant from inventing products. This build puts a (fictional) product catalog in PostgreSQL, embeds it with an ingestion pipeline, retrieves candidates with pgvector similarity search, and, in later commits, generates answers where every recommended product ID is verified against the database before it reaches the shopper.

This build does **not** add reranking, query rewriting, tool calling, live inventory, policy/FAQ documents, LangChain, or auth.

## What changes from Build 04

| Concern | Build 04 | Build 05 |
|---|---|---|
| Product knowledge | None (model's general knowledge) | Catalog in PostgreSQL (120 synthetic products) |
| Vector storage | None | pgvector extension, `product_embeddings` table, filled by an ingestion CLI |
| Retrieval | None | Planned (Commit 03) |
| Grounding | None | Planned: application-side ID verification (Commit 03) |
| UI | Chat + analysis chips | Planned: product cards (Commit 04) |

Build 04 is unchanged and still independently runnable. The structured-output layer, turn lifecycle, SSE events, and API are described in the [Build 04 README](../build-04-structured-outputs/README.md) and are inherited as-is.

## Commit plan

| # | Scope | Status |
|---|---|---|
| 01 | Catalog schema, pgvector tables, product repository, seed data and script | Done |
| 02 | Idempotent embedding ingestion CLI (provider-isolated embedding service) | **Done (this commit)** |
| 03 | Retrieval service and grounded answers with verified product IDs | Planned |
| 04 | Product cards in the web UI, empty states, final docs | Planned |

---

## Commit 01: catalog and storage

### What exists

```
products ──< product_embeddings (1:1, filled in Commit 02)
```

- `apps/api/migrations/003_create-products.sql`: `products` table and `product_stock_status` enum.
- `apps/api/migrations/004_create-product-embeddings.sql`: `vector` extension, `product_embeddings` table, HNSW index.
- `apps/api/src/repositories/product-repository.ts`: `findById`, `findByIds`, `list` (filtered).
- `apps/api/src/seed/product-seed-data.ts`: 120 hand-written fictional products, 12 categories × 10.
- `apps/api/src/scripts/seed-products.ts`: idempotent seed script with `--dry-run`.

As of this commit nothing was embedded and nothing queried the catalog from a request path; Commit 02 adds embedding ingestion and Commit 03 adds retrieval.

### Prerequisite: pgvector

Migration 004 runs `CREATE EXTENSION IF NOT EXISTS vector`, which fails unless pgvector is installed on the PostgreSQL server (version 0.5.0 or later is needed for HNSW). The options below are from memory; **verify each against the [pgvector README](https://github.com/pgvector/pgvector#installation)** before relying on it.

| Environment | Approach |
|---|---|
| Any OS with Docker | Run a PostgreSQL image that bundles pgvector (for example `pgvector/pgvector`) |
| macOS (Homebrew) | `brew install pgvector` for the Homebrew PostgreSQL |
| Debian/Ubuntu | Install the `postgresql-<version>-pgvector` package from the PostgreSQL apt repository |
| Windows | Build from source with Visual Studio C++ tools (`nmake`), or use the Docker image |

Confirm it is available with `psql $DATABASE_URL -c "SELECT * FROM pg_available_extensions WHERE name = 'vector';"`. Creating an extension may require a privileged role.

### Apply the migrations

From `apps/api` with `DATABASE_URL` set:

```bash
pnpm migrate           # all migrations 001-004 on a clean database
```

Coming from an existing Build 04 database, apply only the new ones:

```bash
pnpm migrate:catalog   # 003 + 004
```

`psql` must be on your `PATH`. These scripts use `$DATABASE_URL` shell expansion, so on Windows run them from Git Bash or WSL, or run the `psql -f` commands by hand.

Rollback: `pnpm migrate:catalog:down` drops the catalog tables and enum. It leaves the `vector` extension installed, because other objects may depend on it. `pnpm migrate:down` drops everything, including conversations.

### Seed the catalog

```bash
pnpm seed:products -- --dry-run   # validate the data, no database needed
pnpm seed:products                # upsert into PostgreSQL
```

The seed script reads `DATABASE_URL` only; it does not need `OPENAI_API_KEY`. It upserts by SKU in one transaction and reports `inserted / updated / unchanged`. Running it twice leaves the second run at `120 unchanged`. It never deletes: a SKU removed from the seed file remains in the database.

### Seed data

120 products across Rain Jackets, Hiking Boots, Backpacks, Tents, Sleeping Bags, Water Bottles, Headphones, Smartwatches, Coffee Makers, Desk Lamps, Office Chairs and Yoga Mats. Stock status is mostly `in_stock`, with some `low_stock` and `out_of_stock` rows so filtering has something to do.

**Everything is invented.** Brands, products, specs and prices are synthetic; any resemblance to a real brand or product is coincidental. Attribute keys are consistent within a category (every rain jacket has `waterproof` and `weight_g`) but differ between categories. Some products are deliberately near-duplicates that differ on one attribute (for example a waterproof and a merely water-resistant jacket), to give retrieval something to distinguish.

### Schema

**`products`**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `sku` | TEXT UNIQUE | Natural key; the seed script upserts on it |
| `name`, `brand`, `category`, `description` | TEXT | Non-empty checks |
| `attributes` | JSONB | Must be an object |
| `price` | NUMERIC(10,2) | `>= 0`; the repository returns it as a JS number |
| `currency` | CHAR(3) | Upper-case ISO-style code, default `USD` |
| `stock_status` | enum | `in_stock`, `low_stock`, `out_of_stock` |
| `image_placeholder` | TEXT | Key the UI will map to an illustration |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

**`product_embeddings`**

| Column | Type | Notes |
|---|---|---|
| `product_id` | UUID PK, FK | `ON DELETE CASCADE`; one embedding per product |
| `model` | TEXT | Embedding model name, recorded per row |
| `dimensions` | INTEGER | Checked against the vector's actual length |
| `content_hash` | TEXT | Lets ingestion skip unchanged products (Commit 02) |
| `embedding` | `vector(1536)` | |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

### Design notes and trade-offs

- **The vector dimension is fixed in the column type.** `vector(1536)` assumes a 1536-dimension embedding model. Switching to a model with a different dimension needs a new migration and re-embedding. The `dimensions` column and a `CHECK (dimensions = vector_dims(embedding))` constraint exist so a mismatch fails loudly rather than corrupting search.
- **HNSW index, honestly.** The index uses `vector_cosine_ops` with `m = 16`, `ef_construction = 64`. At 120 rows an exact sequential scan is already instant, and HNSW is approximate, so it can return slightly different results than an exact scan. It is included because it is what a larger catalog would need, and so the schema does not change later. It is not needed at this size.
- **One embedding per product.** Simple and enough here; chunking is not justified by a catalog of short descriptions.
- **`brand` column (deviation).** The plan's field list does not include `brand`. It was added because brand names are one of the places pure vector search is expected to be weak, which would be the justification for optional hybrid search in Commit 03. It is a plain column; remove it if you prefer to stay strictly on the plan.
- **Repository safety.** `findById`/`findByIds` ignore strings that are not valid UUIDs, so IDs supplied by a model can be passed in without a database error. `list` uses parameterized SQL only, clamps `limit` (default 20, max 100), and orders deterministically by `name, id`.

---

## Commit 02: embedding ingestion

```
products ──> compose text ──> sha256 ──> changed? ──> batch ──> EmbeddingService ──> product_embeddings
                                          │                          │
                                          └─ unchanged: skip         └─ EmbeddingProvider (OpenAI adapter)
```

### Files

- `src/embeddings/types.ts`: the `EmbeddingProvider` port and `EmbeddingService` contract.
- `src/embeddings/openai-embedding-provider.ts`: the only file that imports OpenAI types for embeddings. Returns vectors or a sanitized failure kind; never throws.
- `src/embeddings/embedding-service.ts`: guarantees one finite vector per input, in order, each exactly `EMBEDDING_DIMENSIONS` long. A wrong length becomes `dimension_mismatch`.
- `src/embeddings/product-embedding-text.ts`: composes the text to embed and its content hash.
- `src/embeddings/ingestion-service.ts`: the pipeline (decide, batch, embed, store, report).
- `src/repositories/product-embedding-repository.ts`: reads products with their embedding state; upserts vectors.
- `src/scripts/ingest-product-embeddings.ts`: the CLI.

### Run it

From `apps/api`, after `pnpm migrate:catalog` and `pnpm seed:products`, with `OPENAI_API_KEY` and `DATABASE_URL` set:

```bash
pnpm ingest:embeddings -- --dry-run   # what would be embedded; no provider calls, no writes
pnpm ingest:embeddings                # embed new or changed products
pnpm ingest:embeddings -- --force     # re-embed everything
```

The report prints `products`, `skipped`, `embedded`, `failed` (with SKU and a failure category per product), and `not attempted` when a run stops early. The exit code is 1 if anything failed or the run stopped early.

### What is embedded

Name, brand, category, description and attributes (attribute keys sorted, so the text is deterministic). **Price, stock status and SKU are deliberately excluded.** Price and stock change independently of what a product is and are read from the database at answer time, so a price change must not trigger a re-embed or leave a stale price inside a vector. SKU is an identifier, not meaning; if exact SKU lookup proves necessary it is a job for keyword search (Commit 03 considers this only if vector-only search observably fails).

### Idempotency

A product is re-embedded only when its embedding is missing, its content hash differs, or the stored model or dimensions differ from the configured ones (or with `--force`). The hash is SHA-256 of the text prefixed with a text-format version, so changing the text format (`EMBEDDING_TEXT_VERSION`) re-embeds everything. A second run embeds nothing.

### Failure behaviour

- **Dimension mismatch is fatal.** Before any provider call, the CLI reads the column's declared dimension from the database and refuses to run if it differs from `EMBEDDING_DIMENSIONS`. If the provider itself returns vectors of the wrong length, the run stops after that batch, because every remaining batch would fail the same way.
- **Other batch failures** (timeout, rate limit, provider unavailable) are recorded per product, the run continues, and the exit code is 1. Each successful batch is stored in its own transaction before the next starts, so progress survives a crash. Re-running picks up what is left; there is no in-run retry beyond the SDK's own transport retries.
- **Ctrl+C** stops after the current step and reports what was not attempted.
- Logs and reports contain counts, SKUs and failure categories only. Product text, vectors, provider messages and the API key are never printed.

### Configuration

| Variable | Default | Notes |
|---|---|---|
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Changing it makes stored embeddings stale; ingestion re-embeds them |
| `EMBEDDING_DIMENSIONS` | `1536` | Must equal the `vector(N)` column. Sent to the provider via the `dimensions` parameter, which the text-embedding-3 models support and older models reject |
| `EMBEDDING_BATCH_SIZE` | `32` | Texts per provider call |
| `EMBEDDING_TIMEOUT_MS` | `30000` | Per-call timeout |

These live in the shared `config.ts`, so the CLI (and the API server) also require `OPENAI_API_KEY` and `DATABASE_URL`, even for `--dry-run`. The embedding variables all have defaults.

### Not yet true

The provider call shapes (`embeddings.create`, the `dimensions` parameter, response ordering) are written from prior knowledge and are unverified against the installed `openai` version. The column-dimension lookup reads `atttypmod` from `pg_attribute`, which I believe holds `N` for a `vector(N)` column but have not confirmed against a running pgvector. No retrieval exists yet, so nothing measures whether these embeddings are any good.

---

## Environment variables

Commit 01 adds none. Commit 02 adds the four `EMBEDDING_*` variables above (all defaulted). `OPENAI_API_KEY` stays backend-only; never place keys or secrets in `VITE_` variables.

## Local setup

```bash
# 1. PostgreSQL with pgvector available (see prerequisite above)
# 2. Configure apps/api/.env from .env.example
cd apps/api
pnpm install
pnpm migrate
pnpm seed:products
pnpm ingest:embeddings
pnpm dev
```

### Validation commands

```bash
pnpm typecheck
pnpm build
pnpm lint
pnpm seed:products -- --dry-run
pnpm ingest:embeddings -- --dry-run
```

These have not been run as part of this commit's documentation. Some inherited Build 04 tests may fail type-checking; that predates this build.

## Known limitations

- Seed data is synthetic and small (120 products). Retrieval quality on it says little about a real catalog.
- Stock status is static seed data, not live inventory.
- The catalog is not queried by the chat flow yet. Embeddings exist only after you run ingestion.
- Failed batches are not retried within a run; re-run the CLI.
- Embedding quality is unmeasured; no retrieval exists to measure it.
- No retrieval-quality measurement exists yet.
- Nothing here has been executed against PostgreSQL/pgvector or the embeddings API.

## Next constraint

Embeddings exist but nothing reads them. Commit 03 adds retrieval (SQL vector search with metadata filters) and grounded answers, where every recommended product ID is verified against the database.
