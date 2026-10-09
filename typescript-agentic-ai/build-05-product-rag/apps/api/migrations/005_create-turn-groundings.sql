-- Migration 005: Create turn_groundings table
-- Part of Build 05 — Product RAG
--
-- One row per product-search turn that went through retrieval: what was
-- retrieved, what the application verified and recommended, and how the turn
-- ended. Kept separate from `messages` and `turn_analyses`, like them it is
-- application metadata.
--
-- turn_id is the primary key and deliberately not a foreign key (in
-- `messages`, turn_id is only unique together with role). conversation_id is a
-- real foreign key so rows go with their conversation.
--
-- Product IDs are stored in an array and a JSONB document, so they cannot be
-- foreign keys. That is acceptable here because products are never deleted by
-- this application; a reader that hydrates IDs must tolerate a missing one.
-- "recommended is a subset of retrieved" is an application invariant, not
-- something this schema can enforce.

-- ── Up ──────────────────────────────────────────────────────────────────────────

CREATE TABLE turn_groundings (
  turn_id                        UUID PRIMARY KEY,
  conversation_id                UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

  -- 'grounded': at least one verified recommendation.
  -- 'no_match': nothing relevant (see reason).
  -- 'failed':   retrieval or generation failed (see reason).
  status                         TEXT NOT NULL CHECK (status IN ('grounded', 'no_match', 'failed')),
  -- no_match: no_candidates | model_no_match | all_recommendations_rejected
  -- failed:   a short sanitized kind, never provider or user text
  reason                         TEXT,

  -- Filters actually applied to the search (category, maxPrice, currency).
  filters                        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- topK, minSimilarity, embeddingModel at the time of the turn.
  retrieval_params               JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- [{ "productId": "...", "similarity": 0.52 }, ...] in rank order.
  retrieved                      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Verified against the database; empty unless status = 'grounded'.
  recommended_product_ids        UUID[] NOT NULL DEFAULT '{}',
  -- Model recommendations dropped by verification (unknown or not retrieved).
  rejected_recommendation_count  SMALLINT NOT NULL DEFAULT 0 CHECK (rejected_recommendation_count >= 0),

  latency_ms                     INTEGER NOT NULL CHECK (latency_ms >= 0),
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_turn_groundings_shape CHECK (
    (status = 'grounded' AND cardinality(recommended_product_ids) > 0 AND reason IS NULL) OR
    (status <> 'grounded' AND cardinality(recommended_product_ids) = 0 AND reason IS NOT NULL)
  )
);

-- All groundings for a conversation (GET /api/conversations/:id)
CREATE INDEX idx_turn_groundings_conversation
  ON turn_groundings (conversation_id, created_at ASC);

-- ── Down ────────────────────────────────────────────────────────────────────────
-- To rollback:
--   DROP TABLE IF EXISTS turn_groundings;
