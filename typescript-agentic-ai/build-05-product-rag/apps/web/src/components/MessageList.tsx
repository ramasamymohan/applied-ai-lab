import { useEffect, useRef } from "react";
import type {
  AnalysisByTurn,
  ChatMessage,
  LoadState,
  Phase,
} from "../hooks/useChat";
import type { AnalysisSummary } from "../lib/api";

type MessageListProps = {
  messages: ChatMessage[];
  analyses: AnalysisByTurn;
  /** Turn whose reply is a clarifying question, known while streaming. */
  clarifyingTurnId: string | null;
  phase: Phase;
  loadState: LoadState;
  onRetryLoad: () => void;
};

/**
 * Short labels for what the application recognized in a user message.
 * Only stated constraints are shown. A failed or missing analysis shows
 * nothing at all, so analysis trouble never alarms the shopper.
 */
function constraintChips(analysis: AnalysisSummary | undefined): string[] {
  if (!analysis || analysis.status !== "completed") {
    return [];
  }

  const chips: string[] = [];

  if (analysis.category) {
    chips.push(analysis.category);
  }

  if (analysis.budget.max !== null) {
    chips.push(`Up to ${formatBudget(analysis.budget.max, analysis.budget.currency)}`);
  }

  chips.push(...analysis.attributes);

  return chips;
}

function formatBudget(max: number, currency: string | null): string {
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(max);
    } catch {
      // Unrecognized currency code: fall through to a plain number.
      return `${max} ${currency}`;
    }
  }

  return String(max);
}

function isClarification(
  message: ChatMessage,
  analyses: AnalysisByTurn,
  clarifyingTurnId: string | null,
): boolean {
  if (message.role !== "assistant" || message.turnId === null) {
    return false;
  }

  if (message.turnId === clarifyingTurnId) {
    return true;
  }

  const analysis = analyses[message.turnId];

  return analysis?.status === "completed" && analysis.needs_clarification;
}

function statusNote(message: ChatMessage, phase: Phase): string | null {
  if (message.role !== "assistant") {
    return null;
  }

  switch (message.status) {
    case "failed":
      return "This response failed.";
    case "cancelled":
      return "Stopped.";
    case "interrupted":
      return "This response was interrupted before it finished.";
    case "streaming":
      // While live, the typing cursor shows progress. A `streaming` row seen
      // while idle was loaded from the server.
      return phase === "idle"
        ? "A response is still being generated. Reopen this conversation to refresh."
        : null;
    case "completed":
      return null;
  }
}

export function MessageList({
  messages,
  analyses,
  clarifyingTurnId,
  phase,
  loadState,
  onRetryLoad,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, loadState]);

  const isActive = phase !== "idle";

  return (
    <div
      className="messages"
      aria-label="Conversation"
      aria-live="polite"
      aria-busy={isActive || loadState === "loading"}
    >
      {loadState === "loading" && (
        <p className="loading" role="status">
          Loading conversation…
        </p>
      )}

      {loadState === "error" && (
        <div className="load-error">
          <button type="button" onClick={onRetryLoad}>
            Try again
          </button>
        </div>
      )}

      {loadState === "idle" && messages.length === 0 && (
        <div className="empty-state">
          <h2>Hi! I'm Storefront AI.</h2>
          <p>
            Ask me a question about shopping, products, or choosing the right
            item. Your conversations are saved and will be here when you come
            back.
          </p>
        </div>
      )}

      {messages.map((message) => {
        const note = statusNote(message, phase);
        const chips =
          message.role === "user" && message.turnId !== null
            ? constraintChips(analyses[message.turnId])
            : [];
        const clarifying = isClarification(
          message,
          analyses,
          clarifyingTurnId,
        );

        return (
          <article
            key={message.id}
            className={`message message--${message.role}`}
          >
            <span className="message-role">
              {message.role === "user" ? "You" : "Storefront AI"}
            </span>
            {clarifying && (
              <span className="message-tag">Asking a quick question</span>
            )}
            <p>
              {message.content ||
                (message.status === "streaming" && isActive ? (
                  <span className="typing-cursor" aria-hidden="true" />
                ) : null)}
            </p>
            {chips.length > 0 && (
              <ul className="chips" aria-label="What I picked up from this message">
                {chips.map((chip, index) => (
                  <li key={`${index}-${chip}`} className="chip">
                    {chip}
                  </li>
                ))}
              </ul>
            )}
            {note && <span className="message-note">{note}</span>}
          </article>
        );
      })}

      {phase === "submitting" && (
        <p className="loading" role="status">
          Storefront AI is thinking…
        </p>
      )}

      <div ref={endRef} aria-hidden="true" />
    </div>
  );
}
