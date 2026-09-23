import { type FormEvent, useEffect, useRef, useState } from "react";
import { streamChatMessage } from "./lib/api";
import "./App.css";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ChatState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "streaming"; abortController: AbortController }
  | { status: "completed" }
  | { status: "error"; message: string }
  | { status: "cancelled" };

function createMessage(role: Message["role"], content: string): Message {
  return {
    id: crypto.randomUUID(),
    role,
    content,
  };
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    createMessage(
      "assistant",
      "Hi! I'm Storefront AI. Ask me a question about shopping, products, or choosing the right item.",
    ),
  ]);
  const [input, setInput] = useState("");
  const [chatState, setChatState] = useState<ChatState>({ status: "idle" });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Ref to the in-progress assistant message ID so delta appends can find it
  const streamingMessageIdRef = useRef<string | null>(null);

  const isActive =
    chatState.status === "submitting" || chatState.status === "streaming";
  const error =
    chatState.status === "error" ? chatState.message : null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isActive]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const message = input.trim();

    if (!message || isActive) {
      return;
    }

    setInput("");
    setChatState({ status: "submitting" });
    setMessages((current) => [...current, createMessage("user", message)]);

    // Create a placeholder assistant message that will grow as deltas arrive
    const assistantMessageId = crypto.randomUUID();
    streamingMessageIdRef.current = assistantMessageId;
    setMessages((current) => [
      ...current,
      { id: assistantMessageId, role: "assistant", content: "" },
    ]);

    const abortController = new AbortController();
    setChatState({ status: "streaming", abortController });

    streamChatMessage(
      message,
      {
        onDelta(text) {
          setMessages((current) =>
            current.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, content: msg.content + text }
                : msg,
            ),
          );
          // Transition from submitting to streaming on first delta
          setChatState((prev) =>
            prev.status === "submitting"
              ? { status: "streaming", abortController }
              : prev,
          );
        },

        onDone() {
          streamingMessageIdRef.current = null;
          setChatState({ status: "completed" });
          // Reset to idle after a brief moment so the UI feels snappy
          setTimeout(() => {
            setChatState((prev) =>
              prev.status === "completed" ? { status: "idle" } : prev,
            );
          }, 100);
        },

        onError(message) {
          streamingMessageIdRef.current = null;
          setChatState({ status: "error", message });
        },
      },
      abortController.signal,
    );
  }

  function handleStop() {
    if (chatState.status === "streaming") {
      chatState.abortController.abort();
      streamingMessageIdRef.current = null;
      setChatState({ status: "cancelled" });
      setTimeout(() => {
        setChatState((prev) =>
          prev.status === "cancelled" ? { status: "idle" } : prev,
        );
      }, 100);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function getStatusLabel(): string {
    switch (chatState.status) {
      case "submitting":
        return "Sending…";
      case "streaming":
        return "Generating…";
      case "completed":
      case "cancelled":
      case "idle":
      case "error":
        return "Send";
    }
  }

  return (
    <main className="page">
      <section className="chat" aria-labelledby="chat-title">
        <header className="chat-header">
          <div className="brand-mark" aria-hidden="true">
            S
          </div>
          <div>
            <h1 id="chat-title">Storefront AI</h1>
            <p>Your shopping assistant</p>
          </div>
          <span className="status">Build 02</span>
        </header>

        <div
          className="messages"
          aria-label="Conversation"
          aria-live="polite"
          aria-busy={isActive}
        >
          {messages.map((message) => (
            <article
              key={message.id}
              className={`message message--${message.role}`}
            >
              <span className="message-role">
                {message.role === "user" ? "You" : "Storefront AI"}
              </span>
              <p>{message.content || <span className="typing-cursor" aria-hidden="true" />}</p>
            </article>
          ))}

          {chatState.status === "submitting" && (
            <p className="loading" role="status">
              Storefront AI is thinking…
            </p>
          )}

          <div ref={messagesEndRef} aria-hidden="true" />
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <form className="composer" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="chat-input">
            Your message
          </label>
          <textarea
            id="chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a shopping question… (Enter to send)"
            rows={2}
            maxLength={4000}
            disabled={isActive}
          />
          <div className="composer-actions">
            {chatState.status === "streaming" && (
              <button
                type="button"
                className="btn-stop"
                onClick={handleStop}
                aria-label="Stop generating"
              >
                Stop
              </button>
            )}
            <button
              type="submit"
              disabled={isActive || input.trim().length === 0}
            >
              {getStatusLabel()}
            </button>
          </div>
        </form>

        <p className="disclaimer">
          AI-generated responses can be inaccurate. Verify important product
          details before making a decision.
        </p>
      </section>
    </main>
  );
}
