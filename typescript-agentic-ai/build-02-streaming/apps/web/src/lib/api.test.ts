/**
 * Tests for the streaming chat API client.
 *
 * Uses vi.stubGlobal to mock fetch so no real network calls are made.
 * Uses ReadableStream to simulate an SSE response body.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamChatMessage } from "./api";
import type { StreamCallbacks } from "./api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function encodeSSE(events: string[]): Uint8Array {
  return new TextEncoder().encode(events.join(""));
}

function sseFrame(eventName: string, data: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

function makeResponse(
  body: Uint8Array | string,
  options: { status?: number; contentType?: string } = {},
): Response {
  const { status = 200, contentType = "text/event-stream" } = options;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        typeof body === "string" ? new TextEncoder().encode(body) : body,
      );
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "Content-Type": contentType },
  });
}

function collectCallbacks(): {
  callbacks: StreamCallbacks;
  deltas: string[];
  done: boolean;
  errors: string[];
} {
  const deltas: string[] = [];
  let done = false;
  const errors: string[] = [];

  const callbacks: StreamCallbacks = {
    onDelta: (text) => { deltas.push(text); },
    onDone: () => { done = true; },
    onError: (msg) => { errors.push(msg); },
  };

  return { callbacks, deltas, done, errors };
}

// Wait for all microtasks and pending promises to settle
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Successful streaming ──────────────────────────────────────────────────────

describe("streamChatMessage — successful stream", () => {
  it("calls onDelta for each text delta and onDone on completion", async () => {
    const body = encodeSSE([
      sseFrame("delta", { text: "Hello" }),
      sseFrame("delta", { text: ", world" }),
      sseFrame("done", {}),
    ]);
    vi.mocked(fetch).mockResolvedValue(makeResponse(body));

    const { callbacks, deltas, done } = collectCallbacks();
    streamChatMessage("Hi", callbacks);
    await flushPromises();

    expect(deltas).toEqual(["Hello", ", world"]);
    expect(done).toBe(true);
  });

  it("handles a single delta followed by done", async () => {
    const body = encodeSSE([
      sseFrame("delta", { text: "Yes." }),
      sseFrame("done", {}),
    ]);
    vi.mocked(fetch).mockResolvedValue(makeResponse(body));

    const { callbacks, deltas, done } = collectCallbacks();
    streamChatMessage("Any question", callbacks);
    await flushPromises();

    expect(deltas).toEqual(["Yes."]);
    expect(done).toBe(true);
  });

  it("handles an empty stream (no deltas, just done)", async () => {
    const body = encodeSSE([sseFrame("done", {})]);
    vi.mocked(fetch).mockResolvedValue(makeResponse(body));

    const { callbacks, deltas, done } = collectCallbacks();
    streamChatMessage("hi", callbacks);
    await flushPromises();

    expect(deltas).toHaveLength(0);
    expect(done).toBe(true);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("streamChatMessage — error events", () => {
  it("calls onError when the SSE stream contains an error event", async () => {
    const body = encodeSSE([
      sseFrame("delta", { text: "partial" }),
      sseFrame("error", { message: "Generation failed." }),
    ]);
    vi.mocked(fetch).mockResolvedValue(makeResponse(body));

    const { callbacks, errors } = collectCallbacks();
    streamChatMessage("hi", callbacks);
    await flushPromises();

    expect(errors).toEqual(["Generation failed."]);
  });

  it("calls onError when the HTTP response is not ok", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "INVALID_REQUEST", message: "Bad input." } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { callbacks, errors } = collectCallbacks();
    streamChatMessage("", callbacks);
    await flushPromises();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Bad input.");
  });

  it("calls onError when fetch throws a network error", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    const { callbacks, errors } = collectCallbacks();
    streamChatMessage("hi", callbacks);
    await flushPromises();

    expect(errors).toHaveLength(1);
  });

  it("does not call onError when fetch is aborted", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    vi.mocked(fetch).mockRejectedValue(abortError);

    const { callbacks, errors } = collectCallbacks();
    const controller = new AbortController();
    controller.abort();
    streamChatMessage("hi", callbacks, controller.signal);
    await flushPromises();

    expect(errors).toHaveLength(0);
  });

  it("calls onError when the response body is null", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const { callbacks, errors } = collectCallbacks();
    streamChatMessage("hi", callbacks);
    await flushPromises();

    expect(errors).toHaveLength(1);
  });

  it("calls onError when the content-type is not text/event-stream", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeResponse('{"unexpected": true}', {
        status: 200,
        contentType: "application/json",
      }),
    );

    const { callbacks, errors } = collectCallbacks();
    streamChatMessage("hi", callbacks);
    await flushPromises();

    expect(errors).toHaveLength(1);
  });
});

// ── Request payload ───────────────────────────────────────────────────────────

describe("streamChatMessage — request", () => {
  it("sends the message as a JSON POST body", async () => {
    const body = encodeSSE([sseFrame("done", {})]);
    vi.mocked(fetch).mockResolvedValue(makeResponse(body));

    const { callbacks } = collectCallbacks();
    streamChatMessage("find me a laptop", callbacks);
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/chat"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message: "find me a laptop" }),
      }),
    );
  });
});
