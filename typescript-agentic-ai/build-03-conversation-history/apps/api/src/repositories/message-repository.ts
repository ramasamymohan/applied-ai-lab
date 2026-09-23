/**
 * Message repository — PostgreSQL access for messages.
 *
 * All SQL is parameterized. Turn creation is transactional: the user message
 * and assistant placeholder are inserted together and rolled back on failure.
 *
 * The partial unique index `uq_messages_active_streaming` ensures at most one
 * active assistant generation per conversation at the database level.
 */

import type { Pool, PoolClient } from "pg";
import type { MessageRow, MessageStatus } from "../db/types.js";

export type TurnInsertResult = {
  userMessage: MessageRow;
  assistantMessage: MessageRow;
};

export type MessageRepository = {
  /**
   * Create a turn (user message + assistant placeholder) in a single
   * transaction. Verifies the conversation exists. Throws a recognizable
   * error if a streaming assistant message already exists for this
   * conversation (concurrent generation guard).
   */
  createTurn(
    conversationId: string,
    turnId: string,
    userContent: string,
  ): Promise<TurnInsertResult>;

  /** Retrieve all messages for a conversation in chronological order. */
  findByConversationId(conversationId: string): Promise<MessageRow[]>;

  /**
   * Retrieve the most recent completed turns for context building.
   * Returns messages from at most `maxTurns` completed turn pairs,
   * in chronological order. Excludes the specified turn to prevent
   * the current turn from appearing in its own context.
   */
  findRecentCompletedTurns(
    conversationId: string,
    maxTurns: number,
    excludeTurnId: string,
  ): Promise<MessageRow[]>;

  /** Update assistant message content and set a terminal status. */
  finalizeAssistantMessage(
    messageId: string,
    content: string,
    status: MessageStatus,
  ): Promise<void>;

  /**
   * Mark all abandoned streaming assistant messages as interrupted.
   * Called on startup to recover from abrupt process terminations.
   * Returns the count of messages marked.
   */
  markAbandonedStreaming(): Promise<number>;
};

/** Error thrown when a concurrent generation is detected. */
export class ConcurrentGenerationError extends Error {
  constructor(conversationId: string) {
    super(
      `A response is already being generated for conversation ${conversationId}.`,
    );
    this.name = "ConcurrentGenerationError";
  }
}

/** Error thrown when the conversation doesn't exist during turn creation. */
export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation ${conversationId} not found.`);
    this.name = "ConversationNotFoundError";
  }
}

export function createMessageRepository(pool: Pool): MessageRepository {
  return {
    async createTurn(
      conversationId: string,
      turnId: string,
      userContent: string,
    ): Promise<TurnInsertResult> {
      const client: PoolClient = await pool.connect();

      try {
        await client.query("BEGIN");

        // Verify conversation exists
        const convCheck = await client.query(
          `SELECT id FROM conversations WHERE id = $1 FOR UPDATE`,
          [conversationId],
        );

        if (convCheck.rows.length === 0) {
          await client.query("ROLLBACK");
          throw new ConversationNotFoundError(conversationId);
        }

        // Insert user message (always completed)
        const userResult = await client.query<MessageRow>(
          `INSERT INTO messages (conversation_id, turn_id, role, content, status)
           VALUES ($1, $2, 'user', $3, 'completed')
           RETURNING id, conversation_id, turn_id, role, content, status, created_at, updated_at`,
          [conversationId, turnId, userContent],
        );

        // Insert assistant placeholder (streaming status).
        // The partial unique index uq_messages_active_streaming will reject
        // this if another assistant message is already streaming in this
        // conversation.
        let assistantResult;
        try {
          assistantResult = await client.query<MessageRow>(
            `INSERT INTO messages (conversation_id, turn_id, role, content, status)
             VALUES ($1, $2, 'assistant', '', 'streaming')
             RETURNING id, conversation_id, turn_id, role, content, status, created_at, updated_at`,
            [conversationId, turnId],
          );
        } catch (err: unknown) {
          await client.query("ROLLBACK");
          // Check for unique constraint violation on the partial index
          if (
            typeof err === "object" &&
            err !== null &&
            "code" in err &&
            (err as { code: string }).code === "23505"
          ) {
            throw new ConcurrentGenerationError(conversationId);
          }
          throw err;
        }

        // Update conversation timestamp
        await client.query(
          `UPDATE conversations SET updated_at = now() WHERE id = $1`,
          [conversationId],
        );

        await client.query("COMMIT");

        return {
          userMessage: userResult.rows[0]!,
          assistantMessage: assistantResult.rows[0]!,
        };
      } catch (err) {
        // Ensure rollback on any unexpected error
        try {
          await client.query("ROLLBACK");
        } catch {
          // Ignore rollback errors
        }
        throw err;
      } finally {
        client.release();
      }
    },

    async findByConversationId(conversationId: string): Promise<MessageRow[]> {
      const result = await pool.query<MessageRow>(
        `SELECT id, conversation_id, turn_id, role, content, status, created_at, updated_at
         FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [conversationId],
      );
      return result.rows;
    },

    async findRecentCompletedTurns(
      conversationId: string,
      maxTurns: number,
      excludeTurnId: string,
    ): Promise<MessageRow[]> {
      // Find the most recent N completed turn_ids (where both user and
      // assistant messages are completed), then retrieve those messages
      // in chronological order.
      const result = await pool.query<MessageRow>(
        `WITH completed_turns AS (
           SELECT turn_id, MIN(created_at) AS turn_started_at
           FROM messages
           WHERE conversation_id = $1
             AND turn_id != $3
             AND status = 'completed'
           GROUP BY turn_id
           HAVING COUNT(*) = 2
           ORDER BY turn_started_at DESC
           LIMIT $2
         )
         SELECT m.id, m.conversation_id, m.turn_id, m.role, m.content,
                m.status, m.created_at, m.updated_at
         FROM messages m
         INNER JOIN completed_turns ct ON m.turn_id = ct.turn_id
         ORDER BY m.created_at ASC`,
        [conversationId, maxTurns, excludeTurnId],
      );
      return result.rows;
    },

    async finalizeAssistantMessage(
      messageId: string,
      content: string,
      status: MessageStatus,
    ): Promise<void> {
      await pool.query(
        `UPDATE messages
         SET content = $2, status = $3, updated_at = now()
         WHERE id = $1`,
        [messageId, content, status],
      );
    },

    async markAbandonedStreaming(): Promise<number> {
      const result = await pool.query(
        `UPDATE messages
         SET status = 'interrupted', updated_at = now()
         WHERE role = 'assistant' AND status = 'streaming'`,
      );
      return result.rowCount ?? 0;
    },
  };
}
