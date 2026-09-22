import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { streamChatMessage } from "./lib/api";
import type { StreamCallbacks } from "./lib/api";

// ── Module mock ───────────────────────────────────────────────────────────────

vi.mock("./lib/api", () => ({
  streamChatMessage: vi.fn(),
}));

const mockStream = vi.mocked(streamChatMessage);

// ── Helpers ───────────────────────────────────────────────────────────────────

function setup() {
  const user = userEvent.setup();
  render(<App />);
  return { user };
}

async function typeAndSend(user: ReturnType<typeof userEvent.setup>, text: string) {
  const textarea = screen.getByRole("textbox");
  await user.click(textarea);
  await user.type(textarea, text);
  await user.click(screen.getByRole("button", { name: /send/i }));
}

/**
 * Capture the callbacks that streamChatMessage was called with so tests
 * can simulate streaming events.
 */
function captureCallbacks(): StreamCallbacks {
  let captured: StreamCallbacks | null = null;

  mockStream.mockImplementation((_msg, callbacks) => {
    captured = callbacks;
  });

  return new Proxy({} as StreamCallbacks, {
    get(_, key) {
      return (...args: unknown[]) => {
        if (!captured) throw new Error("streamChatMessage not yet called");
        return (captured[key as keyof StreamCallbacks] as (...a: unknown[]) => void)(...args);
      };
    },
  });
}

// ── Initial render ────────────────────────────────────────────────────────────

describe("App — initial render", () => {
  beforeEach(() => mockStream.mockReset());

  it("displays the welcome message from the assistant", () => {
    setup();
    expect(screen.getByText(/I'm Storefront AI/i)).toBeInTheDocument();
  });

  it("renders the chat input", () => {
    setup();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders the send button as disabled when the input is empty", () => {
    setup();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });
});

// ── Sending a message ─────────────────────────────────────────────────────────

describe("App — sending a message", () => {
  beforeEach(() => mockStream.mockReset());

  it("appends the user message to the conversation", async () => {
    mockStream.mockImplementation(() => { /* no-op */ });
    const { user } = setup();
    await typeAndSend(user, "What headphones do you recommend?");
    expect(
      screen.getByText("What headphones do you recommend?"),
    ).toBeInTheDocument();
  });

  it("appends streamed delta text to the assistant message", async () => {
    const callbacks = captureCallbacks();
    const { user } = setup();
    await typeAndSend(user, "Recommend headphones");

    callbacks.onDelta("I recommend ");
    callbacks.onDelta("the Sony WH-1000XM5.");
    callbacks.onDone();

    await waitFor(() =>
      expect(
        screen.getByText("I recommend the Sony WH-1000XM5."),
      ).toBeInTheDocument(),
    );
  });

  it("clears the input after sending", async () => {
    mockStream.mockImplementation(() => { /* no-op */ });
    const { user } = setup();
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    await user.click(textarea);
    await user.type(textarea, "Hello");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(textarea.value).toBe("");
  });

  it("sends the message when Enter is pressed", async () => {
    mockStream.mockImplementation(() => { /* no-op */ });
    const { user } = setup();
    const textarea = screen.getByRole("textbox");
    await user.click(textarea);
    await user.type(textarea, "Hello{Enter}");
    expect(mockStream).toHaveBeenCalledWith(
      "Hello",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("does not send when Shift+Enter is pressed", async () => {
    mockStream.mockImplementation(() => { /* no-op */ });
    const { user } = setup();
    const textarea = screen.getByRole("textbox");
    await user.click(textarea);
    await user.type(textarea, "Hello{Shift>}{Enter}{/Shift}");
    expect(mockStream).not.toHaveBeenCalled();
  });
});

// ── Loading / streaming state ─────────────────────────────────────────────────

describe("App — streaming state", () => {
  beforeEach(() => mockStream.mockReset());

  it("shows the thinking indicator while submitting", async () => {
    mockStream.mockImplementation(() => { /* no-op */ });
    const { user } = setup();
    await typeAndSend(user, "Hello");
    expect(screen.getByRole("status")).toHaveTextContent(/thinking/i);
  });

  it("disables the send button while streaming", async () => {
    mockStream.mockImplementation(() => { /* no-op */ });
    const { user } = setup();
    await typeAndSend(user, "Hello");
    // The button text changes while active
    expect(
      screen.getByRole("button", { name: /sending|generating/i }),
    ).toBeDisabled();
  });

  it("hides the loading indicator after done event", async () => {
    const callbacks = captureCallbacks();
    const { user } = setup();
    await typeAndSend(user, "Hello");
    callbacks.onDone();
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });

  it("prevents duplicate submission while streaming", async () => {
    mockStream.mockImplementation(() => { /* no-op */ });
    const { user } = setup();
    await typeAndSend(user, "First message");
    // Try to submit again — input is disabled so second send should be blocked
    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeDisabled();
    expect(mockStream).toHaveBeenCalledTimes(1);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("App — error handling", () => {
  beforeEach(() => mockStream.mockReset());

  it("displays an error when the stream emits an error event", async () => {
    const callbacks = captureCallbacks();
    const { user } = setup();
    await typeAndSend(user, "Hello");
    callbacks.onError("The assistant is temporarily unavailable.");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /temporarily unavailable/i,
      ),
    );
  });

  it("clears the error on a subsequent successful send", async () => {
    const callbacks = captureCallbacks();
    const { user } = setup();

    // First message errors
    await typeAndSend(user, "First");
    callbacks.onError("Unavailable.");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    // Second message succeeds
    await typeAndSend(user, "Second");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
