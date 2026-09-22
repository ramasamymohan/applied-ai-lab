/**
 * Integration tests for the Fastify application.
 *
 * Uses Fastify's built-in inject() method so no real network connection or
 * OpenAI API key is required.
 *
 * The streaming route writes to reply.raw directly. Fastify inject() buffers
 * the full response body, so SSE tests assert on the concatenated output.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { ChatStreamingService } from "../src/streaming/chat-streaming-service.js";
import {
  deltaEvent,
  doneEvent,
  errorEvent,
  formatSseEvent,
} from "../src/streaming/sse.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStreamingService(
  events: Parameters<typeof formatSseEvent>[0][],
): ChatStreamingService {
  return {
    async *streamReply() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

function buildTestApp(service?: ChatStreamingService) {
  return buildApp({
    webOrigin: "http://localhost:5173",
    chatStreamingService:
      service ??
      makeStreamingService([deltaEvent("echo"), doneEvent()]),
  });
}

// ── Health ────────────────────────────────────────────────────────────────────

test("GET /api/health returns ok", async () => {
  const app = await buildTestApp();
  try {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  } finally {
    await app.close();
  }
});

// ── POST /api/chat — validation ───────────────────────────────────────────────

test("POST /api/chat rejects a whitespace-only message with 400", async () => {
  const app = await buildTestApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "   " },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
  } finally {
    await app.close();
  }
});

test("POST /api/chat rejects an empty string message", async () => {
  const app = await buildTestApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "" },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
  } finally {
    await app.close();
  }
});

test("POST /api/chat rejects a message over 4000 characters", async () => {
  const app = await buildTestApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "a".repeat(4001) },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
  } finally {
    await app.close();
  }
});

test("POST /api/chat rejects a missing message field", async () => {
  const app = await buildTestApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: {},
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
  } finally {
    await app.close();
  }
});

test("POST /api/chat rejects a non-string message field", async () => {
  const app = await buildTestApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: 42 },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
  } finally {
    await app.close();
  }
});

test("POST /api/chat rejects unknown fields (strict schema)", async () => {
  const app = await buildTestApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello", extra: "unexpected" },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
  } finally {
    await app.close();
  }
});

test("POST /api/chat handles a non-JSON body without crashing", async () => {
  const app = await buildTestApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "Content-Type": "application/json" },
      body: "this is not json{{{",
    });
    assert.ok(
      response.statusCode >= 400 && response.statusCode < 500,
      `Expected a 4xx status, got ${response.statusCode}`,
    );
  } finally {
    await app.close();
  }
});

// ── POST /api/chat — SSE streaming ───────────────────────────────────────────

test("POST /api/chat returns SSE content-type for a valid request", async () => {
  const app = await buildTestApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello" },
    });
    assert.equal(response.statusCode, 200);
    assert.ok(
      response.headers["content-type"]?.includes("text/event-stream"),
      `Expected text/event-stream, got ${response.headers["content-type"]}`,
    );
  } finally {
    await app.close();
  }
});

test("POST /api/chat streams delta events followed by done", async () => {
  const service = makeStreamingService([
    deltaEvent("Hello"),
    deltaEvent(", world"),
    doneEvent(),
  ]);
  const app = await buildTestApp(service);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hi" },
    });
    assert.equal(response.statusCode, 200);
    const body = response.body;
    assert.ok(body.includes("event: delta"), "Must include delta events");
    assert.ok(body.includes("event: done"), "Must include done event");
    assert.ok(
      body.includes('"text":"Hello"'),
      'Must include first delta text',
    );
    assert.ok(
      body.includes('"text":", world"'),
      'Must include second delta text',
    );
  } finally {
    await app.close();
  }
});

test("POST /api/chat streams an error event when service yields one", async () => {
  const service = makeStreamingService([
    deltaEvent("Partial"),
    errorEvent("Something went wrong."),
  ]);
  const app = await buildTestApp(service);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hi" },
    });
    assert.equal(response.statusCode, 200);
    const body = response.body;
    assert.ok(body.includes("event: error"), "Must include error event");
    assert.ok(
      body.includes("Something went wrong."),
      "Must include the error message",
    );
  } finally {
    await app.close();
  }
});

test("POST /api/chat accepts a message of exactly 4000 characters", async () => {
  const app = await buildTestApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "a".repeat(4000) },
    });
    assert.equal(response.statusCode, 200);
  } finally {
    await app.close();
  }
});
