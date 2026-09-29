import type { FormEvent, KeyboardEvent } from "react";
import type { Phase } from "../hooks/useChat";

type ComposerProps = {
  draft: string;
  phase: Phase;
  /** True while a conversation is loading. */
  loading: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
};

export function Composer({
  draft,
  phase,
  loading,
  onDraftChange,
  onSend,
  onStop,
}: ComposerProps) {
  const isActive = phase !== "idle";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSend();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function sendLabel(): string {
    switch (phase) {
      case "submitting":
        return "Sending…";
      case "streaming":
        return "Generating…";
      case "idle":
        return "Send";
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="chat-input">
        Your message
      </label>
      <textarea
        id="chat-input"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask a shopping question… (Enter to send)"
        rows={2}
        maxLength={4000}
        disabled={isActive || loading}
      />
      <div className="composer-actions">
        {isActive && (
          <button
            type="button"
            className="btn-stop"
            onClick={onStop}
            aria-label="Stop generating"
          >
            Stop
          </button>
        )}
        <button
          type="submit"
          disabled={isActive || loading || draft.trim().length === 0}
        >
          {sendLabel()}
        </button>
      </div>
    </form>
  );
}
