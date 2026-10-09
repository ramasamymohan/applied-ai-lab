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

// ── Build 05 ──────────────────────────────────────────────────────────────────

export type ProductStockStatus = "in_stock" | "low_stock" | "out_of_stock";

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  /** JSONB object; keys vary by category. */
  attributes: Record<string, unknown>;
  /** Selected as float8 so callers get a number, not a NUMERIC string. */
  price: number;
  currency: string;
  stock_status: ProductStockStatus;
  image_placeholder: string;
  created_at: Date;
  updated_at: Date;
};

export type TurnGroundingStatus = "grounded" | "no_match" | "failed";

export type TurnGroundingRow = {
  turn_id: string;
  conversation_id: string;
  status: TurnGroundingStatus;
  reason: string | null;
  /** JSONB. Untrusted until re-validated by a reader. */
  filters: unknown;
  retrieval_params: unknown;
  /** JSONB array of { productId, similarity } in rank order. */
  retrieved: unknown;
  recommended_product_ids: string[];
  rejected_recommendation_count: number;
  latency_ms: number;
  created_at: Date;
};
