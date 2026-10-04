-- Migration 004: Enable pgvector and create product_embeddings
-- Part of Build 05 — Product Knowledge, Embeddings, Vector Search, and RAG
--
-- Requires the pgvector extension (0.5.0 or later, for HNSW) to be INSTALLED
-- on the PostgreSQL server before this runs. CREATE EXTENSION only enables an
-- extension that is already installed, and usually needs a privileged role.
-- See the Build 05 README for installation per platform.

-- ── Up ──────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

-- One embedding per product.
--
-- The vector dimension is part of the column type and is fixed here at 1536,
-- the default output size of OpenAI's text-embedding-3-small. Changing the
-- embedding model to one with a different size requires a new migration that
-- changes this column and rebuilds the index. The ingestion script (next
-- commit) compares its configured dimension with this column and fails
-- clearly on a mismatch.
--
-- `model` and `dimensions` record how each row was produced so a model change
-- is detectable, and `content_hash` records the source text so unchanged
-- products are not embedded again.
CREATE TABLE product_embeddings (
  product_id    UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  model         TEXT NOT NULL CHECK (length(btrim(model)) > 0),
  dimensions    INTEGER NOT NULL CHECK (dimensions > 0),
  content_hash  TEXT NOT NULL CHECK (length(content_hash) > 0),
  embedding     vector(1536) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The recorded dimension must match the stored vector.
  CONSTRAINT ck_product_embeddings_dimensions
    CHECK (dimensions = vector_dims(embedding))
);

-- Approximate nearest-neighbor index, cosine distance.
--
-- m = 16 and ef_construction = 64 are pgvector's defaults, stated explicitly
-- so the choice is visible. At this catalog size (about a hundred rows) an
-- exact scan is already fast and an index adds nothing; it is here to
-- demonstrate the production pattern. The index also changes results slightly,
-- because HNSW is approximate and the exact scan is not.
CREATE INDEX idx_product_embeddings_hnsw
  ON product_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── Down ────────────────────────────────────────────────────────────────────────
-- To rollback:
--   DROP TABLE IF EXISTS product_embeddings;
-- The vector extension is left installed: other databases or objects may use
-- it. To remove it deliberately: DROP EXTENSION IF EXISTS vector;
