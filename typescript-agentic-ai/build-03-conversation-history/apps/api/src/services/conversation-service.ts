/**
 * Conversation service — orchestrates repositories and streaming.
 *
 * This service owns the business logic for conversations:
 *
 *   - Creating conversations with a title derived from the first message
 *   - Sending messages: creating a turn, building model context from
 *     completed turns, streaming the reply, and persisting the result
 *   - Listing and retrieving conversations with their messages
 *
 * Route handlers call this service rather than touching repositories or
 * the streaming layer directly. This keeps the route layer thin and the
 * orchestration testable.
 */

import type { ConversationRow, MessageRow } from "../db/types.js";
import type { ConversationRepository } from "../repositories/conversation-repository.js";
import type {
  MessageRepository,
  TurnInsertResult,
} from "../repositories/message-repository.js";
import type {
  ChatStreamingService,
  ContextMessage,
} from "../streaming/chat-streaming-service.js";
import type { StreamEvent } from "../streaming/sse.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ConversationWithMessages = ConversationRow & {
  messages: MessageRow[];
};

export type SendMessageResult = {
  turn: TurnInsertResult;
  stream: AsyncIterable<StreamEvent>;
};

export type ConversationService = {
  /** Create a new conversation. Title is derived from the first user message. */
  createConversation(firstMessage: string): Promise<ConversationRow>;

  /** List conversations, most recently updated first. */
  listConversations(): Promise<ConversationRow[]>;

  /** Get a conversation with all its messages. Returns null if not found. */
  getConversation(id: string): Promise<ConversationWithMessages | null>;

  /**
   * Send a message in a conversation. Creates the turn (user message +
   * assistant placeholder), builds context from prior completed turns,
   * and returns the turn and an async iterable of streaming events.
   *
   * The caller is responsible for iterating the stream and writing SSE
   * events to the response. When the stream completes, the assistant
   * message is finalized in the database automatically.
   */
  sendMessage(
    conversationId: string,
    message: string,
  ): Promise<SendMessageResult>;
};

type CreateConversationServiceOptions = {
  conversationRepository: ConversationRepository;
  messageRepository: MessageRepository;
  chatStreamingService: ChatStreamingService;
  maxContextTurns: number;
};

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Derive a short conversation title from the first user message.
 * Truncates to 80 characters with an ellipsis if needed.
 */
function deriveTitle(message: string): string {
  const maxLength = 80;
  const trimmed = message.trim().replace(/\n+/g, " ");
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return trimmed.slice(0, maxLength - 1) + "…";
}

export function createConversationService(
  options: CreateConversationServiceOptions,
): ConversationService {
  const {
    conversationRepository,
    messageRepository,
    chatStreamingService,
    maxContextTurns,
  } = options;

  return {
    async createConversation(
      firstMessage: string,
    ): Promise<ConversationRow> {
      const title = deriveTitle(firstMessage);
      return conversationRepository.create(title);
    },

    async listConversations(): Promise<ConversationRow[]> {
      return conversationRepository.list();
    },

    async getConversation(
      id: string,
    ): Promise<ConversationWithMessages | null> {
      const conversation = await conversationRepository.findById(id);
      if (!conversation) {
        return null;
      }

      const messages = await messageRepository.findByConversationId(id);

      return { ...conversation, messages };
    },

    async sendMessage(
      conversationId: string,
      message: string,
    ): Promise<SendMessageResult> {
      // Generate a turn ID for this exchange
      const turnId = crypto.randomUUID();

      // Create the turn — inserts user message + assistant placeholder
      // in a single transaction. Throws ConcurrentGenerationError or
      // ConversationNotFoundError on constraint violations.
      const turn = await messageRepository.createTurn(
        conversationId,
        turnId,
        message,
      );

      // Build context from recent completed turns
      const contextRows = await messageRepository.findRecentCompletedTurns(
        conversationId,
        maxContextTurns,
        turnId,
      );

      const contextMessages: ContextMessage[] = contextRows.map((row) => ({
        role: row.role,
        content: row.content,
      }));

      // Create the persistent streaming wrapper. This wraps the raw streaming
      // service and handles finalizing the assistant message in the database
      // when the stream completes, fails, or is cancelled.
      const stream = persistentStream({
        messageRepository,
        assistantMessageId: turn.assistantMessage.id,
        innerStream: chatStreamingService.streamReply({
          message,
          contextMessages,
          conversationId,
          messageId: turn.assistantMessage.id,
          signal: undefined, // Signal is attached by the route handler
        }),
      });

      return { turn, stream };
    },
  };
}

// ── Persistent streaming wrapper ──────────────────────────────────────────────

type PersistentStreamOptions = {
  messageRepository: MessageRepository;
  assistantMessageId: string;
  innerStream: AsyncIterable<StreamEvent>;
};

/**
 * Wraps a raw streaming iterable and accumulates the generated text.
 * When the stream completes (done event) or fails (error event), the
 * assistant message is finalized in the database with the accumulated
 * content and the appropriate status.
 *
 * The caller iterates this wrapper instead of the raw stream. All events
 * are forwarded unchanged.
 */
async function* persistentStream(
  options: PersistentStreamOptions,
): AsyncIterable<StreamEvent> {
  const { messageRepository, assistantMessageId, innerStream } = options;

  let accumulatedText = "";
  let finalized = false;

  try {
    for await (const event of innerStream) {
      if (event.event === "delta") {
        accumulatedText += event.data.text;
      }

      yield event;

      if (event.event === "done") {
        await messageRepository.finalizeAssistantMessage(
          assistantMessageId,
          accumulatedText,
          "completed",
        );
        finalized = true;
        return;
      }

      if (event.event === "error") {
        await messageRepository.finalizeAssistantMessage(
          assistantMessageId,
          accumulatedText,
          "failed",
        );
        finalized = true;
        return;
      }
    }

    // Stream ended without done or error — treat as cancelled
    if (!finalized) {
      await messageRepository.finalizeAssistantMessage(
        assistantMessageId,
        accumulatedText,
        "cancelled",
      );
      finalized = true;
    }
  } catch (err) {
    // Finalize as failed if not already done
    if (!finalized) {
      try {
        await messageRepository.finalizeAssistantMessage(
          assistantMessageId,
          accumulatedText,
          "failed",
        );
      } catch {
        // Best-effort finalization — the startup recovery will catch
        // messages left in streaming status on next restart
      }
    }
    throw err;
  }
}
