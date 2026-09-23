/**
 * Shared database types for Build 03.
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
