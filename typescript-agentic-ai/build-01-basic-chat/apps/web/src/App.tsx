import { type FormEvent, useEffect, useRef, useState } from "react";
import { sendChatMessage } from "./lib/api";
import "./App.css";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const message = input.trim();

    if (!message || isLoading) {
      return;
    }

    setInput("");
    setError(null);
    setIsLoading(true);
    setMessages((current) => [...current, createMessage("user", message)]);

    try {
      const reply = await sendChatMessage(message);
      setMessages((current) => [
        ...current,
        createMessage("assistant", reply),
      ]);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
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
          <span className="status">Build 01</span>
        </header>

        <div
          className="messages"
          aria-label="Conversation"
          aria-live="polite"
          aria-busy={isLoading}
        >
          {messages.map((message) => (
            <article
              key={message.id}
              className={`message message--${message.role}`}
            >
              <span className="message-role">
                {message.role === "user" ? "You" : "Storefront AI"}
              </span>
              <p>{message.content}</p>
            </article>
          ))}

          {isLoading && (
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
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || input.trim().length === 0}
          >
            {isLoading ? "Sending…" : "Send"}
          </button>
        </form>

        <p className="disclaimer">
          AI-generated responses can be inaccurate. Verify important product
          details before making a decision.
        </p>
      </section>
    </main>
  );
}
