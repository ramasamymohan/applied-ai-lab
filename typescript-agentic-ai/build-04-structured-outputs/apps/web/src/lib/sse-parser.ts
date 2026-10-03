/**
 * SSE stream parser (Build 03, extended in Build 04 with `analysis`).
 *
 * Converts raw response chunks from fetch() into application-level events.
 * Handles all the tricky cases:
 *
 *   - Multiple events arriving in a single network chunk
 *   - A single event split across multiple chunks
 *   - UTF-8 multi-byte sequences split at chunk boundaries (via TextDecoder
 *     stream mode)
 *   - CRLF and LF line endings
 *   - Incomplete events at the end of a stream (discarded — no bare `done`)
 *
 * Usage:
 *
 *   const parser = createSseParser(onEvent);
 *   parser.push(chunk);   // call for each decoded string chunk
 *   parser.flush();       // call once at end of stream
 */

// ── Event types (mirrors the backend contract) ────────────────────────────────

export type SseDeltaEvent = {
  event: "delta";
  data: { text: string };
};

export type SseDoneEvent = {
  event: "done";
  data: { conversationId: string; messageId: string };
};

export type SseErrorEvent = {
  event: "error";
  data: { message: string };
};

/**
 * Build 04, additive: how the application understood the message. Optional on
 * the wire; a stream without it is valid.
 */
export type SseAnalysisEvent = {
  event: "analysis";
  data: {
    turnId: string;
    status: "completed" | "analysis_failed";
    intent: string | null;
    needsClarification: boolean;
  };
};

export type SseEvent =
  | SseAnalysisEvent
  | SseDeltaEvent
  | SseDoneEvent
  | SseErrorEvent;

// ── Parser ────────────────────────────────────────────────────────────────────

export type SseParser = {
  /**
   * Push a decoded string chunk into the parser.
   * Calls the onEvent callback for each complete event found.
   */
  push(chunk: string): void;

  /**
   * Signal end of stream. Discards any incomplete buffered event.
   */
  flush(): void;
};

export function createSseParser(onEvent: (event: SseEvent) => void): SseParser {
  // Buffer holds the accumulated text between event boundaries (\n\n)
  let buffer = "";

  function processBuffer(): void {
    // Events are delimited by a blank line (\n\n or \r\n\r\n)
    // Process as many complete events as exist in the buffer
    while (true) {
      // Find the double-newline that terminates an SSE event
      // Handle both \n\n and \r\n\r\n
      const lfIdx = buffer.indexOf("\n\n");
      const crlfIdx = buffer.indexOf("\r\n\r\n");

      let endIdx: number;
      let stepSize: number;

      if (lfIdx === -1 && crlfIdx === -1) {
        // No complete event yet — wait for more data
        break;
      } else if (lfIdx === -1) {
        endIdx = crlfIdx;
        stepSize = 4; // "\r\n\r\n".length
      } else if (crlfIdx === -1) {
        endIdx = lfIdx;
        stepSize = 2; // "\n\n".length
      } else {
        // Both found — take the earlier one
        if (lfIdx < crlfIdx) {
          endIdx = lfIdx;
          stepSize = 2;
        } else {
          endIdx = crlfIdx;
          stepSize = 4;
        }
      }

      const eventBlock = buffer.slice(0, endIdx);
      buffer = buffer.slice(endIdx + stepSize);

      parseEvent(eventBlock);
    }
  }

  function parseEvent(block: string): void {
    let eventName = "";
    let dataLine = "";

    // Parse line by line, handling both \r\n and \n
    const lines = block.split(/\r?\n/);

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLine = line.slice("data:".length).trim();
      }
      // Ignore id:, retry:, comments (:), and unknown fields
    }

    if (!eventName || !dataLine) {
      // Incomplete or unrecognized event — skip
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(dataLine);
    } catch {
      // Malformed JSON payload — skip this event
      return;
    }

    // Type-check and dispatch each known event type
    if (eventName === "delta") {
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "text" in parsed &&
        typeof (parsed as { text: unknown }).text === "string"
      ) {
        onEvent({
          event: "delta",
          data: { text: (parsed as { text: string }).text },
        });
      }
      return;
    }

    if (eventName === "done") {
      // A done event without both IDs is malformed. Ignoring it means the
      // stream ends without a terminal event, which the API client reports
      // as an interrupted connection rather than a silent success.
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "conversationId" in parsed &&
        typeof (parsed as { conversationId: unknown }).conversationId ===
          "string" &&
        "messageId" in parsed &&
        typeof (parsed as { messageId: unknown }).messageId === "string"
      ) {
        onEvent({
          event: "done",
          data: {
            conversationId: (parsed as { conversationId: string })
              .conversationId,
            messageId: (parsed as { messageId: string }).messageId,
          },
        });
      }
      return;
    }

    if (eventName === "error") {
      const message =
        typeof parsed === "object" &&
        parsed !== null &&
        "message" in parsed &&
        typeof (parsed as { message: unknown }).message === "string"
          ? (parsed as { message: string }).message
          : "An unknown error occurred.";

      onEvent({ event: "error", data: { message } });
      return;
    }

    if (eventName === "analysis") {
      // Malformed analysis is dropped: it is informational, so the reply
      // continues without it.
      if (typeof parsed === "object" && parsed !== null) {
        const data = parsed as Record<string, unknown>;
        const status = data["status"];
        const intent = data["intent"];

        if (
          typeof data["turnId"] === "string" &&
          (status === "completed" || status === "analysis_failed") &&
          (typeof intent === "string" || intent === null) &&
          typeof data["needsClarification"] === "boolean"
        ) {
          onEvent({
            event: "analysis",
            data: {
              turnId: data["turnId"],
              status,
              intent,
              needsClarification: data["needsClarification"],
            },
          });
        }
      }
      return;
    }

    // Unknown event type — ignore safely
  }

  return {
    push(chunk: string): void {
      buffer += chunk;
      processBuffer();
    },

    flush(): void {
      // Discard any remaining incomplete data
      buffer = "";
    },
  };
}
