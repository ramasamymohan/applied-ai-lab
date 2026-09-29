/**
 * Conversation repository — PostgreSQL access for conversations.
 *
 * All SQL is parameterized. This module keeps database access out of route
 * handlers and business orchestration.
 */

import type { Pool } from "pg";
import type { ConversationRow } from "../db/types.js";

export type ConversationRepository = {
  create(title: string): Promise<ConversationRow>;
  findById(id: string): Promise<ConversationRow | null>;
  list(): Promise<ConversationRow[]>;
  updateTitle(id: string, title: string): Promise<void>;
  touch(id: string): Promise<void>;
};

export function createConversationRepository(
  pool: Pool,
): ConversationRepository {
  return {
    async create(title: string): Promise<ConversationRow> {
      const result = await pool.query<ConversationRow>(
        `INSERT INTO conversations (title)
         VALUES ($1)
         RETURNING id, title, created_at, updated_at`,
        [title],
      );
      return result.rows[0]!;
    },

    async findById(id: string): Promise<ConversationRow | null> {
      const result = await pool.query<ConversationRow>(
        `SELECT id, title, created_at, updated_at
         FROM conversations
         WHERE id = $1`,
        [id],
      );
      return result.rows[0] ?? null;
    },

    async list(): Promise<ConversationRow[]> {
      const result = await pool.query<ConversationRow>(
        `SELECT id, title, created_at, updated_at
         FROM conversations
         ORDER BY updated_at DESC
         LIMIT 50`,
      );
      return result.rows;
    },

    async updateTitle(id: string, title: string): Promise<void> {
      await pool.query(
        `UPDATE conversations
         SET title = $2, updated_at = now()
         WHERE id = $1`,
        [id, title],
      );
    },

    async touch(id: string): Promise<void> {
      await pool.query(
        `UPDATE conversations
         SET updated_at = now()
         WHERE id = $1`,
        [id],
      );
    },
  };
}
