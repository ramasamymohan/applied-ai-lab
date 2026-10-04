-- Migration 001: Create conversations and messages tables
-- Part of Build 03 — Conversation History & Persistent State

-- ── Up ──────────────────────────────────────────────────────────────────────────

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Conversations table
CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for listing conversations ordered by most recently updated
CREATE INDEX idx_conversations_updated_at ON conversations (updated_at DESC);

-- Message status enum
CREATE TYPE message_status AS ENUM (
  'completed',
  'streaming',
  'failed',
  'cancelled',
  'interrupted'
);

-- Messages table
CREATE TABLE messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id          UUID NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content          TEXT NOT NULL DEFAULT '',
  status           message_status NOT NULL DEFAULT 'completed',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One message per role within a turn
ALTER TABLE messages
  ADD CONSTRAINT uq_messages_turn_role UNIQUE (turn_id, role);

-- At most one active streaming assistant response per conversation.
-- This prevents concurrent generation requests on the same conversation.
CREATE UNIQUE INDEX uq_messages_active_streaming
  ON messages (conversation_id)
  WHERE role = 'assistant' AND status = 'streaming';

-- Index for retrieving messages in chronological order per conversation
CREATE INDEX idx_messages_conversation_created
  ON messages (conversation_id, created_at ASC);

-- ── Down ────────────────────────────────────────────────────────────────────────
-- To rollback:
--   DROP TABLE IF EXISTS messages;
--   DROP TABLE IF EXISTS conversations;
--   DROP TYPE IF EXISTS message_status;
