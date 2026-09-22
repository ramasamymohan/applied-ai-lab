/**
 * Streaming chat API client for Build 02.
 *
 * Sends a POST /api/chat request and reads the SSE response body
 * incrementally using fetch() + ReadableStream + TextDecoder.
 *
 * Dispatches parsed SSE events to caller-supplied callbacks. This module has
 * no React dependency and can be used or tested in isolation.
 *
 * Security: the API key lives only on the backend. This module never sends
 * or references any credential.
 */

import { createSseParser, type SseEvent } from "./sse-parser";

export type ChatRequest = {
  message: string;
};

export type StreamCallbacks = {
  /** Called for each text delta as it arrives */
  onDelta: (text: string) => void;
  /** Called once when the stream completes successfully */
  onDone: () => void;
  /** Called when a stream-level error occurs */
  onError: (message: string) => void;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

/**
 * Stream a chat reply from the backend.
 *
 * Returns a cleanup function that aborts the request if called (e.g. when
 * the user clicks Stop or the component unmounts).
 */
export function streamChatMessage(
  message: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): void {
  // Fire-and-forget — errors surface through callbacks, not through a thrown
  // promise. This keeps the caller's React code simple.
  void (async () => {
    let response: Response;

    try {
      response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message } satisfies ChatRequest),
        signal,
      });
    } catch (err) {
      // AbortError means the user cancelled — not a failure
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      callbacks.onError("Could not connect to the assistant. Please try again.");
      return;
    }

    // Pre-stream HTTP errors (validation, 5xx before headers committed)
    if (!response.ok) {
      let errorMessage =
        "The request failed. Please try again.";

      try {
        const payload: unknown = await response.json();
        if (
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof (payload as { error: unknown }).error === "object" &&
          (payload as { error: unknown }).error !== null &&
          "message" in (payload as { error: { message: unknown } }).error &&
          typeof (payload as { error: { message: unknown } }).error.message === "string"
        ) {
          errorMessage = (payload as { error: { message: string } }).error
            .message;
        }
      } catch {
        // Ignore JSON parse failures on error responses
      }

      callbacks.onError(errorMessage);
      return;
    }

    if (!response.body) {
      callbacks.onError("The server returned an empty response.");
      return;
    }

    // Verify the server actually sent SSE
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      callbacks.onError("Unexpected response format from the server.");
      return;
    }

    // ── Read the stream ───────────────────────────────────────────────────────

    const reader = response.body.getReader();
    // stream: true means TextDecoder handles multi-byte characters split
    // across chunk boundaries correctly
    const decoder = new TextDecoder("utf-8", { fatal: false });

    const parser = createSseParser((event: SseEvent) => {
      if (event.event === "delta") {
        callbacks.onDelta(event.data.text);
      } else if (event.event === "done") {
        callbacks.onDone();
      } else if (event.event === "error") {
        callbacks.onError(event.data.message);
      }
    });

    try {
      while (true) {
        // Check abort signal between reads
        if (signal?.aborted) {
          break;
        }

        const { done, value } = await reader.read();

        if (done) {
          parser.flush();
          break;
        }

        // Decode incrementally — stream: true preserves partial multi-byte
        // sequences between chunks
        const chunk = decoder.decode(value, { stream: true });
        parser.push(chunk);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled — not an error
        return;
      }
      callbacks.onError("The connection was interrupted. Please try again.");
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Ignore if already released
      }
    }
  })();
}
