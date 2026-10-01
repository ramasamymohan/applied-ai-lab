/**
 * Shared database types (Build 03, extended in Build 04).
 *
 * These types mirror the PostgreSQL schema and are used by both the
 * conversation and message repositories. They are not API response types —
 * route handlers map these to the appropriate response shapes.
 */

export type MessageStatus =
  | "completed"
  | "streaming"
  | "failed"
  | "cancelled"
  | "interrupted";

export type ConversationRow = {
  id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  turn_id: string;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
  created_at: Date;
  updated_at: Date;
};

// ── Build 04 ──────────────────────────────────────────────────────────────────

export type TurnAnalysisStatus = "completed" | "analysis_failed";

export type TurnAnalysisRow = {
  turn_id: string;
  conversation_id: string;
  status: TurnAnalysisStatus;
  failure_kind: string | null;
  contract_name: string;
  schema_version: number;
  /** JSONB. Untrusted until re-validated against the contract version. */
  payload: unknown;
  attempts: number;
  repaired: boolean;
  latency_ms: number;
  created_at: Date;
};
