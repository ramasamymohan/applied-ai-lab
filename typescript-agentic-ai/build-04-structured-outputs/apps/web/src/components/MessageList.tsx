import { useEffect, useRef } from "react";
import type { ChatMessage, LoadState, Phase } from "../hooks/useChat";

type MessageListProps = {
  messages: ChatMessage[];
  phase: Phase;
  loadState: LoadState;
  onRetryLoad: () => void;
};

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

        return (
          <article
            key={message.id}
            className={`message message--${message.role}`}
          >
            <span className="message-role">
              {message.role === "user" ? "You" : "Storefront AI"}
            </span>
            <p>
              {message.content ||
                (message.status === "streaming" && isActive ? (
                  <span className="typing-cursor" aria-hidden="true" />
                ) : null)}
            </p>
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
