/**
 * SSE event contract for streaming (Build 03, extended in Builds 04 and 05).
 *
 * Application-level event types:
 *
 *   analysis — (Build 04, additive) Sanitized summary of how the application
 *            understood the shopper's message. At most one per stream, before
 *            any delta. Optional: clients that do not know it can ignore it,
 *            and its absence means analysis did not run or was not reported.
 *   grounding — (Build 05, additive) For a product-search turn: how the answer
 *            was grounded in the catalog, with the verified recommended
 *            products read from the database. At most one per stream, before
 *            the delta that carries the reply text. Optional and ignorable.
 *   delta  — Carries newly generated text. Zero or more per stream.
 *   done   — Marks successful completion. Exactly one, after all deltas.
 *            Carries conversation and message identifiers so the client
 *            can track which conversation was created or continued.
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
  data: {
    conversationId: string;
    messageId: string;
  };
};

/**
 * Sanitized analysis summary. Contains the classified intent and whether the
 * application is asking a clarifying question, never raw model output.
 * `intent` is null when analysis failed. Analysis failure does not block the
 * reply; it is reported so clients can stay quiet about it.
 */
export type AnalysisEvent = {
  event: "analysis";
  data: {
    turnId: string;
    status: "completed" | "analysis_failed";
    intent: string | null;
    needsClarification: boolean;
  };
};

/** A verified product, read from the database (never from model output). */
export type GroundedProductSummary = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  currency: string;
  stockStatus: "in_stock" | "low_stock" | "out_of_stock";
  imagePlaceholder: string;
};

/**
 * `products` holds only application-verified recommendations, in order. It is
 * empty unless status is "grounded".
 */
export type GroundingEvent = {
  event: "grounding";
  data: {
    turnId: string;
    status: "grounded" | "no_match" | "failed";
    products: GroundedProductSummary[];
  };
};

export type ErrorEvent = {
  event: "error";
  data: { message: string };
};

/** Union of all application-level streaming events. */
export type StreamEvent =
  | AnalysisEvent
  | GroundingEvent
  | DeltaEvent
  | DoneEvent
  | ErrorEvent;

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

export function doneEvent(
  conversationId: string,
  messageId: string,
): DoneEvent {
  return { event: "done", data: { conversationId, messageId } };
}

export function analysisEvent(data: AnalysisEvent["data"]): AnalysisEvent {
  return { event: "analysis", data };
}

export function groundingEvent(data: GroundingEvent["data"]): GroundingEvent {
  return { event: "grounding", data };
}

export function errorEvent(message: string): ErrorEvent {
  return { event: "error", data: { message } };
}
