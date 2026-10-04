import assert from "node:assert/strict";
import test from "node:test";
import {
  deltaEvent,
  doneEvent,
  errorEvent,
  formatSseEvent,
} from "../src/streaming/sse.js";

// ── formatSseEvent — delta ────────────────────────────────────────────────────

test("formatSseEvent: delta with normal text produces correct SSE frame", () => {
  const result = formatSseEvent(deltaEvent("Hello, world!"));
  assert.equal(result, 'event: delta\ndata: {"text":"Hello, world!"}\n\n');
});

test("formatSseEvent: delta with empty string produces a valid SSE frame", () => {
  const result = formatSseEvent(deltaEvent(""));
  assert.equal(result, 'event: delta\ndata: {"text":""}\n\n');
});

test("formatSseEvent: delta with embedded newlines escapes them in JSON", () => {
  const result = formatSseEvent(deltaEvent("line one\nline two"));
  // JSON.stringify escapes \n as \\n so the data: line stays single-line
  assert.equal(result, 'event: delta\ndata: {"text":"line one\\nline two"}\n\n');
  // The raw string must not contain a bare newline inside the data value
  const dataLine = result.split("\n")[1] ?? "";
  assert.ok(dataLine.startsWith("data: "), "second line must start with data:");
  assert.ok(!dataLine.slice(6).includes("\n"), "data value must not contain bare newline");
});

test("formatSseEvent: delta with double quotes escapes them in JSON", () => {
  const result = formatSseEvent(deltaEvent('He said "hello"'));
  assert.equal(result, 'event: delta\ndata: {"text":"He said \\"hello\\""}\n\n');
});

test("formatSseEvent: delta with backslash escapes it in JSON", () => {
  const result = formatSseEvent(deltaEvent("path\\to\\file"));
  assert.equal(result, 'event: delta\ndata: {"text":"path\\\\to\\\\file"}\n\n');
});

test("formatSseEvent: delta with unicode characters preserves them", () => {
  const result = formatSseEvent(deltaEvent("café ☕ 日本語"));
  assert.equal(result, 'event: delta\ndata: {"text":"café ☕ 日本語"}\n\n');
});

// ── formatSseEvent — done ─────────────────────────────────────────────────────

test("formatSseEvent: done event produces correct SSE frame", () => {
  const result = formatSseEvent(doneEvent());
  assert.equal(result, "event: done\ndata: {}\n\n");
});

// ── formatSseEvent — error ────────────────────────────────────────────────────

test("formatSseEvent: error event produces correct SSE frame", () => {
  const result = formatSseEvent(errorEvent("The assistant is temporarily unavailable."));
  assert.equal(
    result,
    'event: error\ndata: {"message":"The assistant is temporarily unavailable."}\n\n',
  );
});

test("formatSseEvent: error message with special characters is safely escaped", () => {
  const result = formatSseEvent(errorEvent('Error: "quota" exceeded\nnew line'));
  const parsed = JSON.parse(result.split("\n")[1]?.replace("data: ", "") ?? "{}") as unknown;
  assert.ok(typeof parsed === "object" && parsed !== null);
  assert.equal((parsed as { message: string }).message, 'Error: "quota" exceeded\nnew line');
});

// ── SSE frame structure ───────────────────────────────────────────────────────

test("formatSseEvent: every event ends with a double newline (SSE terminator)", () => {
  const events = [
    formatSseEvent(deltaEvent("text")),
    formatSseEvent(doneEvent()),
    formatSseEvent(errorEvent("fail")),
  ];
  for (const frame of events) {
    assert.ok(frame.endsWith("\n\n"), `Frame must end with \\n\\n: ${JSON.stringify(frame)}`);
  }
});

test("formatSseEvent: every event starts with the correct event: line", () => {
  assert.ok(formatSseEvent(deltaEvent("x")).startsWith("event: delta\n"));
  assert.ok(formatSseEvent(doneEvent()).startsWith("event: done\n"));
  assert.ok(formatSseEvent(errorEvent("x")).startsWith("event: error\n"));
});

test("formatSseEvent: data line is always the second line", () => {
  const frame = formatSseEvent(deltaEvent("hello"));
  const lines = frame.split("\n");
  assert.ok((lines[1] ?? "").startsWith("data: "), "second line must be data:");
});

test("formatSseEvent: data payload is valid JSON", () => {
  const frames = [
    formatSseEvent(deltaEvent("some text")),
    formatSseEvent(doneEvent()),
    formatSseEvent(errorEvent("oops")),
  ];
  for (const frame of frames) {
    const dataLine = frame.split("\n")[1] ?? "";
    const json = dataLine.replace("data: ", "");
    assert.doesNotThrow(() => JSON.parse(json), `Payload must be valid JSON: ${json}`);
  }
});

// ── Multiple consecutive events ───────────────────────────────────────────────

test("concatenated events form a valid SSE stream", () => {
  const stream =
    formatSseEvent(deltaEvent("Hello")) +
    formatSseEvent(deltaEvent(", world")) +
    formatSseEvent(doneEvent());

  // A well-formed SSE stream separates events with \n\n
  // Split on double newline, filter empty trailing entries
  const eventBlocks = stream.split("\n\n").filter((s) => s.length > 0);
  assert.equal(eventBlocks.length, 3);
  assert.ok((eventBlocks[0] ?? "").startsWith("event: delta"));
  assert.ok((eventBlocks[1] ?? "").startsWith("event: delta"));
  assert.ok((eventBlocks[2] ?? "").startsWith("event: done"));
});

// ── Convenience constructors ──────────────────────────────────────────────────

test("deltaEvent returns the correct shape", () => {
  const ev = deltaEvent("hi");
  assert.equal(ev.event, "delta");
  assert.equal(ev.data.text, "hi");
});

test("doneEvent returns the correct shape", () => {
  const ev = doneEvent();
  assert.equal(ev.event, "done");
  assert.deepEqual(ev.data, {});
});

test("errorEvent returns the correct shape", () => {
  const ev = errorEvent("something failed");
  assert.equal(ev.event, "error");
  assert.equal(ev.data.message, "something failed");
});
