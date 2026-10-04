-- Migration 003: Create products table
-- Part of Build 05 — Product Knowledge, Embeddings, Vector Search, and RAG
--
-- A fictional product catalog. The data is synthetic (see src/seed/) and
-- exists to demonstrate retrieval; it is not real retail data.

-- ── Up ──────────────────────────────────────────────────────────────────────────

-- Static in this build. Live stock arrives with tools in Build 06.
CREATE TYPE product_stock_status AS ENUM (
  'in_stock',
  'low_stock',
  'out_of_stock'
);

CREATE TABLE products (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Human-facing identifier, also the natural key for idempotent seeding.
  sku                TEXT NOT NULL UNIQUE CHECK (length(btrim(sku)) > 0),

  name               TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  brand              TEXT NOT NULL CHECK (length(btrim(brand)) > 0),
  category           TEXT NOT NULL CHECK (length(btrim(category)) > 0),
  description        TEXT NOT NULL CHECK (length(btrim(description)) > 0),

  -- Free-form facts such as waterproof, weight_g, capacity_l. Keys vary by
  -- category, which is why this is JSONB and not columns.
  attributes         JSONB NOT NULL DEFAULT '{}'::jsonb
                       CHECK (jsonb_typeof(attributes) = 'object'),

  -- Exact decimal. The API layer reads it as a number for display.
  price              NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  currency           CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),

  stock_status       product_stock_status NOT NULL DEFAULT 'in_stock',

  -- A key the UI maps to a placeholder illustration. No real images exist.
  image_placeholder  TEXT NOT NULL,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Metadata filters used by retrieval (category and budget)
CREATE INDEX idx_products_category ON products (lower(category));
CREATE INDEX idx_products_price ON products (price);

-- ── Down ────────────────────────────────────────────────────────────────────────
-- To rollback (after rolling back 004):
--   DROP TABLE IF EXISTS products;
--   DROP TYPE IF EXISTS product_stock_status;
