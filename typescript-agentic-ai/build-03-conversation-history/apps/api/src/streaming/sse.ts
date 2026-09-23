/**
 * SSE event contract for Build 02 streaming.
 *
 * Three application-level event types are used:
 *
 *   delta  — Carries newly generated text. Zero or more per stream.
 *   done   — Marks successful completion. Exactly one, after all deltas.
 *   error  — Carries a safe user-facing error message. Sent when
 *            generation fails after streaming has already begun.
 *
 * Wire format (SSE):
 *
 *   event: <name>\n
 *   data: <JSON payload>\n
 *   \n
 *
 * The blank line after `data:` terminates the SSE event. JSON encoding
 * ensures that newlines and special characters inside generated text are
 * safely escaped before being written to the stream.
 */

// ── Event types ───────────────────────────────────────────────────────────────

export type DeltaEvent = {
  event: "delta";
  data: { text: string };
};

export type DoneEvent = {
  event: "done";
  data: Record<string, never>;
};

export type ErrorEvent = {
  event: "error";
  data: { message: string };
};

/** Union of all application-level streaming events. */
export type StreamEvent = DeltaEvent | DoneEvent | ErrorEvent;

// ── Serialisation ─────────────────────────────────────────────────────────────

/**
 * Serialises a StreamEvent into an SSE-framed string ready to write to
 * the HTTP response.
 *
 * JSON.stringify handles escaping of newlines, quotes, and other special
 * characters inside string values, so the resulting `data:` line is
 * always a single line safe for the SSE wire format.
 */
export function formatSseEvent(event: StreamEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

// ── Convenience constructors ──────────────────────────────────────────────────

export function deltaEvent(text: string): DeltaEvent {
  return { event: "delta", data: { text } };
}

export function doneEvent(): DoneEvent {
  return { event: "done", data: {} };
}

export function errorEvent(message: string): ErrorEvent {
  return { event: "error", data: { message } };
}
