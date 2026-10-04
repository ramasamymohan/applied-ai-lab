-- Migration 002: Create turn_analyses table
-- Part of Build 04 — Structured Outputs & Reliable Model Contracts
--
-- One row per turn: the validated structured analysis of the shopper's message
-- (a ShoppingRequest), or a record that analysis failed. Kept separate from
-- `messages` so message rows stay the UI's history and analysis stays
-- application metadata.
--
-- turn_id is the primary key. It is deliberately not a foreign key: in
-- `messages`, turn_id is only unique together with role. conversation_id is a
-- real foreign key so analyses are removed with their conversation.

-- ── Up ──────────────────────────────────────────────────────────────────────────

CREATE TABLE turn_analyses (
  turn_id          UUID PRIMARY KEY,
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

  -- 'completed': payload holds a validated contract value.
  -- 'analysis_failed': payload is NULL and failure_kind says why.
  status           TEXT NOT NULL CHECK (status IN ('completed', 'analysis_failed')),
  failure_kind     TEXT,

  -- Contract identity, so readers can interpret payload across versions.
  contract_name    TEXT NOT NULL,
  schema_version   INTEGER NOT NULL CHECK (schema_version >= 1),
  payload          JSONB,

  attempts         SMALLINT NOT NULL CHECK (attempts >= 0),
  repaired         BOOLEAN NOT NULL DEFAULT FALSE,
  latency_ms       INTEGER NOT NULL CHECK (latency_ms >= 0),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_turn_analyses_payload_matches_status CHECK (
    (status = 'completed'       AND payload IS NOT NULL AND failure_kind IS NULL) OR
    (status = 'analysis_failed' AND payload IS NULL     AND failure_kind IS NOT NULL)
  )
);

-- Retrieval of all analyses for a conversation (GET /api/conversations/:id)
CREATE INDEX idx_turn_analyses_conversation
  ON turn_analyses (conversation_id, created_at ASC);

-- ── Down ────────────────────────────────────────────────────────────────────────
-- To rollback:
--   DROP TABLE IF EXISTS turn_analyses;
