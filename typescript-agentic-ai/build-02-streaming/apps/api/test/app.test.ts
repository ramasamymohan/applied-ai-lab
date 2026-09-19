import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildTestApp(overrides?: { generateReply?: (msg: string) => Promise<string> }) {
  return buildApp({
    webOrigin: "http://localhost:5173",
    chatService: {
      generateReply: overrides?.generateReply ?? (async (message) => `echo: ${message}`),
    },
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

// ── POST /api/chat — happy path ───────────────────────────────────────────────

test("POST /api/chat returns the assistant reply", async () => {
  const app = await buildTestApp({
    generateReply: async (message) => `Assistant received: ${message}`,
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Help me choose headphones." },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      reply: "Assistant received: Help me choose headphones.",
    });
  } finally {
    await app.close();
  }
});

// ── POST /api/chat — request validation ──────────────────────────────────────

test("POST /api/chat rejects a whitespace-only message", async () => {
  const app = await buildTestApp({
    generateReply: async () => { throw new Error("Should not be called"); },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "   " },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
    assert.equal(typeof response.json().error.message, "string");
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
    // Fastify returns 400 for malformed JSON — the server must not crash
    assert.ok(
      response.statusCode >= 400 && response.statusCode < 500,
      `Expected a 4xx status, got ${response.statusCode}`,
    );
  } finally {
    await app.close();
  }
});

// ── POST /api/chat — error containment ───────────────────────────────────────

test("POST /api/chat returns 502 when the service throws", async () => {
  const app = await buildTestApp({
    generateReply: async () => { throw new Error("Internal provider detail"); },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello" },
    });
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().error.code, "MODEL_REQUEST_FAILED");
  } finally {
    await app.close();
  }
});

test("POST /api/chat does not leak the internal error message to the client", async () => {
  const app = await buildTestApp({
    generateReply: async () => { throw new Error("Internal provider detail"); },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello" },
    });
    const body = JSON.stringify(response.json());
    assert.equal(
      body.includes("Internal provider detail"),
      false,
      "Internal error message must not appear in the response",
    );
  } finally {
    await app.close();
  }
});

test("POST /api/chat 502 response has the expected user-safe message", async () => {
  const app = await buildTestApp({
    generateReply: async () => { throw new Error("anything"); },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Hello" },
    });
    assert.equal(
      response.json().error.message,
      "The assistant is temporarily unavailable. Please try again.",
    );
  } finally {
    await app.close();
  }
});
