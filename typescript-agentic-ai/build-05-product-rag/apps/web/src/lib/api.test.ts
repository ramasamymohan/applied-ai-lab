import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendChatMessage } from "./api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function mockFetchNetworkError() {
  global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
}

function mockFetchBadJson(status: number) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => { throw new SyntaxError("Unexpected token"); },
  } as unknown as Response);
}

// ── Success ───────────────────────────────────────────────────────────────────

describe("sendChatMessage — success", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the reply string from a successful response", async () => {
    mockFetch(200, { reply: "Here are some great headphones." });
    const result = await sendChatMessage("Help me pick headphones.");
    expect(result).toBe("Here are some great headphones.");
  });

  it("passes the message in the request body", async () => {
    mockFetch(200, { reply: "Got it." });
    await sendChatMessage("What is the return policy?");
    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(call[1]?.body as string);
    expect(body).toEqual({ message: "What is the return policy?" });
  });

  it("posts to /api/chat with JSON content type", async () => {
    mockFetch(200, { reply: "Sure." });
    await sendChatMessage("Hello");
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toContain("/api/chat");
    expect((call[1]?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });
});

// ── Server error responses ────────────────────────────────────────────────────

describe("sendChatMessage — server errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("throws the server error message when the error shape is valid", async () => {
    mockFetch(502, {
      error: {
        code: "MODEL_REQUEST_FAILED",
        message: "The assistant is temporarily unavailable. Please try again.",
      },
    });
    await expect(sendChatMessage("Hello")).rejects.toThrow(
      "The assistant is temporarily unavailable. Please try again.",
    );
  });

  it("falls back to a generic message when the error shape is unexpected", async () => {
    mockFetch(500, { unexpected: "shape" });
    await expect(sendChatMessage("Hello")).rejects.toThrow(
      "The request failed. Please try again.",
    );
  });

  it("falls back to a generic message when the error body is null", async () => {
    mockFetch(503, null);
    await expect(sendChatMessage("Hello")).rejects.toThrow(
      "The request failed. Please try again.",
    );
  });

  it("throws when the success response fails Zod validation (empty reply)", async () => {
    mockFetch(200, { reply: "" });
    await expect(sendChatMessage("Hello")).rejects.toThrow(
      "The server returned an unexpected response.",
    );
  });

  it("throws when the success response has the wrong shape", async () => {
    mockFetch(200, { message: "wrong key" });
    await expect(sendChatMessage("Hello")).rejects.toThrow(
      "The server returned an unexpected response.",
    );
  });

  it("throws when the response body is not valid JSON", async () => {
    mockFetchBadJson(200);
    await expect(sendChatMessage("Hello")).rejects.toThrow(
      "The server returned an unexpected response.",
    );
  });
});

// ── AbortSignal ───────────────────────────────────────────────────────────────

describe("sendChatMessage — abort", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes the AbortSignal to fetch", async () => {
    mockFetch(200, { reply: "OK" });
    const controller = new AbortController();
    await sendChatMessage("Hello", controller.signal);
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[1]?.signal).toBe(controller.signal);
  });

  it("propagates an AbortError when the request is cancelled", async () => {
    const controller = new AbortController();
    global.fetch = vi.fn().mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );
    await expect(
      sendChatMessage("Hello", controller.signal),
    ).rejects.toThrow("Aborted");
  });
});
