/**
 * API client (Build 03, extended in Build 04 with analysis summaries).
 *
 * Two kinds of calls:
 *
 *   - JSON reads (list conversations, get a conversation with its messages).
 *     Responses are validated with Zod before they reach React state.
 *
 *   - Streaming writes (create a conversation / send a message). The SSE
 *     response body is read incrementally with fetch() + ReadableStream and
 *     dispatched to caller-supplied callbacks.
 *
 * This module has no React dependency.
 *
 * Security: the LLM provider API key lives only on the backend. This module
 * never sends or references any credential.
 */

import { z } from "zod";
import { createSseParser, type SseEvent } from "./sse-parser";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

// ── Response schemas ──────────────────────────────────────────────────────────

const messageStatusSchema = z.enum([
  "completed",
  "streaming",
  "failed",
  "cancelled",
  "interrupted",
]);

const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const conversationMessageSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  turn_id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  status: messageStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

const conversationListSchema = z.object({
  conversations: z.array(conversationSummarySchema),
});

// Build 04: how the application understood each turn. Intent stays a plain
// string so a newer server adding intents does not break an older client.
const analysisSummarySchema = z.discriminatedUnion("status", [
  z.object({
    turn_id: z.string(),
    status: z.literal("completed"),
    schema_version: z.number(),
    intent: z.string(),
    category: z.string().nullable(),
    budget: z.object({
      max: z.number().nullable(),
      currency: z.string().nullable(),
    }),
    attributes: z.array(z.string()),
    needs_clarification: z.boolean(),
  }),
  z.object({
    turn_id: z.string(),
    status: z.literal("analysis_failed"),
  }),
]);

// Analyses are optional decoration. Missing, malformed, or unrecognized
// entries are dropped one by one, so a bad analysis can never stop a
// conversation from loading.
const analysesSchema = z
  .array(z.unknown())
  .default([])
  .transform((items) =>
    items.flatMap((item) => {
      const parsed = analysisSummarySchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  );

const conversationDetailSchema = z.object({
  conversation: conversationSummarySchema.extend({
    messages: z.array(conversationMessageSchema),
    analyses: analysesSchema,
  }),
});

const errorEnvelopeSchema = z.object({
  error: z.object({ message: z.string() }),
});

export type MessageStatus = z.infer<typeof messageStatusSchema>;
export type AnalysisSummary = z.infer<typeof analysisSummarySchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type ConversationDetail = z.infer<
  typeof conversationDetailSchema
>["conversation"];

// ── Errors ────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const parsed = errorEnvelopeSchema.safeParse(await response.json());
    if (parsed.success) {
      return parsed.data.error.message;
    }
  } catch {
    // Non-JSON error body — use the fallback
  }
  return fallback;
}

// ── JSON reads ────────────────────────────────────────────────────────────────

async function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, { signal });
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    throw new ApiError(
      "Could not connect to the server. Please try again.",
      0,
    );
  }

  if (!response.ok) {
    throw new ApiError(
      await readErrorMessage(response, "The request failed. Please try again."),
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError("Unexpected response from the server.", response.status);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError("Unexpected response format from the server.", 502);
  }

  return parsed.data;
}

export async function listConversations(
  signal?: AbortSignal,
): Promise<ConversationSummary[]> {
  const result = await getJson(
    "/api/conversations",
    conversationListSchema,
    signal,
  );
  return result.conversations;
}

export async function getConversation(
  conversationId: string,
  signal?: AbortSignal,
): Promise<ConversationDetail> {
  const result = await getJson(
    `/api/conversations/${encodeURIComponent(conversationId)}`,
    conversationDetailSchema,
    signal,
  );
  return result.conversation;
}

// ── Streaming writes ──────────────────────────────────────────────────────────

export type StreamTarget = {
  /** null creates a new conversation; otherwise appends to an existing one. */
  conversationId: string | null;
  message: string;
};

export type StreamError = {
  message: string;
  /**
   * "request": the server rejected the request before streaming began, so no
   * turn was created. "stream": the failure happened after streaming began,
   * so a (possibly partial) assistant message exists on the server.
   */
  phase: "request" | "stream";
};

export type StreamCallbacks = {
  /** Called once when the stream is established and the conversation ID is known. */
  onStart: (info: { conversationId: string }) => void;
  /**
   * Called when the server reports how it understood the message (Build 04).
   * Optional: older servers never send it, and it can arrive at most once.
   */
  onAnalysis?: (info: {
    turnId: string;
    status: "completed" | "analysis_failed";
    intent: string | null;
    needsClarification: boolean;
  }) => void;
  /** Called for each text delta as it arrives. */
  onDelta: (text: string) => void;
  /** Called once when the server reports successful completion. */
  onDone: (info: { conversationId: string; messageId: string }) => void;
  /** Called once when the request or stream fails. Not called on user abort. */
  onError: (error: StreamError) => void;
};

/**
 * Create a conversation or send a message, and stream the assistant reply.
 *
 * Fire-and-forget: outcomes surface through callbacks. Aborting the signal
 * stops the request silently — no callback is invoked, so the caller owns
 * the state transition for a user-initiated stop.
 */
export function streamConversationReply(
  target: StreamTarget,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): void {
  void (async () => {
    const path =
      target.conversationId === null
        ? "/api/conversations"
        : `/api/conversations/${encodeURIComponent(target.conversationId)}/messages`;

    let response: Response;

    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: target.message }),
        signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }
      callbacks.onError({
        phase: "request",
        message: "Could not connect to the assistant. Please try again.",
      });
      return;
    }

    // Pre-stream HTTP errors: validation (400), not found (404),
    // concurrent generation (409), rate limit (429), server (5xx).
    if (!response.ok) {
      callbacks.onError({
        phase: "request",
        message: await readErrorMessage(
          response,
          "The request failed. Please try again.",
        ),
      });
      return;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.body || !contentType.includes("text/event-stream")) {
      callbacks.onError({
        phase: "request",
        message: "Unexpected response format from the server.",
      });
      return;
    }

    // The conversation ID arrives in a header so it is known before any
    // text does, even if the stream later fails or the user stops it.
    const conversationId =
      response.headers.get("x-conversation-id") ?? target.conversationId;

    if (conversationId) {
      callbacks.onStart({ conversationId });
    }

    // ── Read the stream ─────────────────────────────────────────────────────

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let terminal = false;

    const parser = createSseParser((event: SseEvent) => {
      if (terminal) {
        return;
      }

      if (event.event === "analysis") {
        callbacks.onAnalysis?.(event.data);
      } else if (event.event === "delta") {
        callbacks.onDelta(event.data.text);
      } else if (event.event === "done") {
        terminal = true;
        callbacks.onDone(event.data);
      } else if (event.event === "error") {
        terminal = true;
        callbacks.onError({ phase: "stream", message: event.data.message });
      }
    });

    try {
      while (!terminal) {
        const { done, value } = await reader.read();

        if (done) {
          parser.flush();
          break;
        }

        parser.push(decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }
      if (!terminal) {
        terminal = true;
        callbacks.onError({
          phase: "stream",
          message: "The connection was interrupted. Please try again.",
        });
      }
      return;
    } finally {
      reader.cancel().catch(() => {
        // Stream may already be closed
      });
    }

    // The body ended without a done or error event.
    if (!terminal && !signal?.aborted) {
      callbacks.onError({
        phase: "stream",
        message: "The connection was interrupted. Please try again.",
      });
    }
  })();
}
