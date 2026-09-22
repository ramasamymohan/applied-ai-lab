/**
 * OpenAI Responses API streaming service for Build 02.
 *
 * Consumes provider streaming events and translates them into application-level
 * StreamEvents (delta | done | error). Provider-specific event details stay
 * isolated here and never leak into the route handler.
 *
 * Usage:
 *
 *   const service = createChatStreamingService({ apiKey, model });
 *   for await (const event of service.streamReply(message, signal)) {
 *     // event is DeltaEvent | DoneEvent | ErrorEvent
 *   }
 */

import OpenAI from "openai";
import {
  deltaEvent,
  doneEvent,
  errorEvent,
  type StreamEvent,
} from "./sse.js";

// ── Service interface ─────────────────────────────────────────────────────────

export type ChatStreamingService = {
  /**
   * Returns an async iterable of StreamEvents for the given message.
   *
   * Yields zero or more delta events followed by a done event on success.
   * Yields an error event as the final item on failure.
   *
   * Never throws — all errors are surfaced as error events so the caller can
   * forward them directly to the SSE response without an extra try/catch.
   */
  streamReply(
    message: string,
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent>;
};

type CreateChatStreamingServiceOptions = {
  apiKey: string;
  model: string;
};

// ── System instructions ───────────────────────────────────────────────────────

const SYSTEM_INSTRUCTIONS = `
You are Storefront AI, a helpful shopping assistant for an online retailer.

Help customers understand product categories, compare general product
characteristics, and make informed shopping decisions.

Do not invent current prices, inventory, shipping estimates, or retailer
policies. If the user asks for specific store information that you do not
have, explain that you do not have access to live store data.

Be concise, friendly, and transparent about uncertainty.
`.trim();

// ── Implementation ────────────────────────────────────────────────────────────

export function createChatStreamingService(
  options: CreateChatStreamingServiceOptions,
): ChatStreamingService {
  const client = new OpenAI({
    apiKey: options.apiKey,
    timeout: 60_000,
    maxRetries: 0, // Retries that restart generation are unsafe during streaming
  });

  return {
    async *streamReply(
      message: string,
      signal?: AbortSignal,
    ): AsyncIterable<StreamEvent> {
      let stream: Awaited<ReturnType<typeof client.responses.stream>> | null =
        null;

      try {
        stream = await client.responses.stream(
          {
            model: options.model,
            instructions: SYSTEM_INSTRUCTIONS,
            input: message,
          },
          { signal },
        );

        for await (const event of stream) {
          // Abort signal was triggered — stop consuming events
          if (signal?.aborted) {
            break;
          }

          // Text delta events carry newly generated text
          if (
            event.type === "response.output_text.delta" &&
            typeof event.delta === "string" &&
            event.delta.length > 0
          ) {
            yield deltaEvent(event.delta);
          }

          // response.completed signals successful end of generation
          if (event.type === "response.completed") {
            yield doneEvent();
            return;
          }

          // response.failed signals a provider-side failure
          if (event.type === "response.failed") {
            yield errorEvent(
              "The assistant could not complete the response. Please try again.",
            );
            return;
          }
        }

        // Stream ended without a response.completed or response.failed event.
        // This can happen on cancellation (signal aborted) or unexpected
        // termination. Do not yield done — the client will treat the missing
        // done as an interrupted stream.
      } catch (err) {
        // AbortError means the client cancelled — not a failure
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

        // Any other exception is a provider error — surface safely
        yield errorEvent(
          "The assistant is temporarily unavailable. Please try again.",
        );
      } finally {
        // Cancel the upstream provider stream if it is still open
        try {
          await stream?.cancel();
        } catch {
          // Ignore cancel errors — stream may already be closed
        }
      }
    },
  };
}
