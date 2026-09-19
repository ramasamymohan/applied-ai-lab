import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { sendChatMessage } from "./lib/api";

// ── Module mock ───────────────────────────────────────────────────────────────

vi.mock("./lib/api", () => ({
  sendChatMessage: vi.fn(),
}));


const mockSend = vi.mocked(sendChatMessage);

// ── Helpers ───────────────────────────────────────────────────────────────────

function setup() {
  const user = userEvent.setup();
  render(<App />);
  return { user };
}

async function sendMessage(user: ReturnType<typeof userEvent.setup>, text: string) {
  const textarea = screen.getByRole("textbox");
  await user.click(textarea);
  await user.type(textarea, text);
  await user.click(screen.getByRole("button", { name: /send/i }));
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}
// ── Initial render ────────────────────────────────────────────────────────────

describe("App — initial render", () => {
  beforeEach(() => mockSend.mockReset());

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
  beforeEach(() => mockSend.mockReset());

  it("appends the user message to the conversation", async () => {
    mockSend.mockResolvedValue("Noted.");
    const { user } = setup();
    await sendMessage(user, "What headphones do you recommend?");
    expect(
      screen.getByText("What headphones do you recommend?"),
    ).toBeInTheDocument();
  });

  it("appends the assistant reply to the conversation", async () => {
    mockSend.mockResolvedValue("I recommend the Sony WH-1000XM5.");
    const { user } = setup();
    await sendMessage(user, "Recommend headphones");
    await waitFor(() =>
      expect(
        screen.getByText("I recommend the Sony WH-1000XM5."),
      ).toBeInTheDocument(),
    );
  });

  it("clears the input after sending", async () => {
    mockSend.mockResolvedValue("OK");
    const { user } = setup();
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    await user.click(textarea);
    await user.type(textarea, "Hello");
    await user.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(textarea.value).toBe(""));
  });

  it("sends the message when Enter is pressed", async () => {
    mockSend.mockResolvedValue("Roger that.");
    const { user } = setup();
    const textarea = screen.getByRole("textbox");
    await user.click(textarea);
    await user.type(textarea, "Hello{Enter}");
    expect(mockSend).toHaveBeenCalledWith("Hello");
  });

  it("does not send when Shift+Enter is pressed", async () => {
    mockSend.mockResolvedValue("Roger that.");
    const { user } = setup();
    const textarea = screen.getByRole("textbox");
    await user.click(textarea);
    await user.type(textarea, "Hello{Shift>}{Enter}{/Shift}");
    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ── Loading state ─────────────────────────────────────────────────────────────

describe("App — loading state", () => {
  beforeEach(() => mockSend.mockReset());

  it("shows the loading indicator while awaiting a reply", async () => {
    const deferred = createDeferred<string>();
    mockSend.mockReturnValue(deferred.promise);
    const { user } = setup();
    await sendMessage(user, "Hello");
    expect(screen.getByRole("status")).toHaveTextContent(/thinking/i);

    deferred.resolve("Here you go.");
  });

  it("disables the send button while loading", async () => {
    const deferred = createDeferred<string>();
    mockSend.mockReturnValue(deferred.promise);
    const { user } = setup();
    await sendMessage(user, "Hello");
    expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled();
    deferred.resolve("Here you go.");
  });

  it("hides the loading indicator after the reply arrives", async () => {
    mockSend.mockResolvedValue("Here you go.");
    const { user } = setup();
    await sendMessage(user, "Hello");
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("App — error handling", () => {
  beforeEach(() => mockSend.mockReset());

  it("clears the error on a subsequent successful send", async () => {
    mockSend
      .mockRejectedValueOnce(new Error("Unavailable."))
      .mockResolvedValueOnce("Back online.");
    const { user } = setup();
    await sendMessage(user, "First");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    await sendMessage(user, "Second");
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("shows a fallback message when the error has no message", async () => {
    mockSend.mockRejectedValue("not an Error object");
    const { user } = setup();
    await sendMessage(user, "Hello");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /something went wrong/i,
      ),
    );
  });
});
