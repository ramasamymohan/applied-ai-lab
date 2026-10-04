/**
 * Conversation state for the Storefront AI chat UI.
 *
 * PostgreSQL (via the API) is the source of truth. This hook keeps a view of
 * it in React state and follows one rule: while a reply is streaming, the UI
 * shows optimistic local messages; as soon as the stream ends — completed,
 * failed, or stopped — the conversation is re-read from the server so the
 * view matches what was actually persisted.
 *
 * Build 04: each turn may carry an analysis (what the application understood
 * from the message). Full analyses come only from the server read, so the
 * recognized constraints appear when a turn is reconciled. During streaming
 * the `analysis` event is used only to flag a clarifying question. Analysis
 * is decoration: its absence or failure never changes how a turn behaves.
 *
 * Switching conversations is disabled while a reply is generating. Stopping
 * a reply aborts the request; the server finalizes the message as
 * `cancelled` with the partial text.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  getConversation,
  isAbortError,
  listConversations,
  streamConversationReply,
  type AnalysisSummary,
  type ConversationMessage,
  type ConversationSummary,
  type MessageStatus,
} from "../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
  /** Server turn ID. Null for optimistic messages until `analysis` arrives. */
  turnId: string | null;
};

/** Analyses keyed by turn ID. */
export type AnalysisByTurn = Record<string, AnalysisSummary>;

/** idle → submitting (request sent, no text yet) → streaming → idle */
export type Phase = "idle" | "submitting" | "streaming";

export type LoadState = "idle" | "loading" | "error";

type ActiveTurn = {
  userId: string;
  assistantId: string;
  text: string;
};

// Reconciliation after a stop can race the server's finalization write.
const RECONCILE_MAX_ATTEMPTS = 5;
const RECONCILE_RETRY_MS = 300;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toChatMessage(message: ConversationMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status,
    turnId: message.turn_id,
  };
}

function toAnalysisMap(analyses: AnalysisSummary[]): AnalysisByTurn {
  const map: AnalysisByTurn = {};
  for (const analysis of analyses) {
    map[analysis.turn_id] = analysis;
  }
  return map;
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError
    ? err.message
    : "Something went wrong. Please try again.";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useChat() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [analyses, setAnalyses] = useState<AnalysisByTurn>({});
  // Turn whose reply is a clarifying question, known live before the read.
  const [clarifyingTurnId, setClarifyingTurnId] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // Refs hold values that async callbacks must read at call time, not at
  // the render in which the callback was created.
  const activeIdRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const streamConversationIdRef = useRef<string | null>(null);
  const activeTurnRef = useRef<ActiveTurn | null>(null);

  const isActive = phase !== "idle";

  // ── Conversation list ───────────────────────────────────────────────────────

  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await listConversations());
      setListError(null);
    } catch (err) {
      if (!isAbortError(err)) {
        setListError(errorMessage(err));
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    listConversations(controller.signal)
      .then((list) => {
        setConversations(list);
        setListError(null);
      })
      .catch((err: unknown) => {
        if (!isAbortError(err)) {
          setListError(errorMessage(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setListLoading(false);
        }
      });

    return () => {
      controller.abort();
      // Stop any in-flight reply when the component unmounts.
      abortRef.current?.abort();
    };
  }, []);

  // ── Loading a conversation ──────────────────────────────────────────────────

  const loadConversation = useCallback(
    async (id: string) => {
      const seq = ++loadSeqRef.current;

      activeIdRef.current = id;
      setActiveId(id);
      setMessages([]);
      setAnalyses({});
      setClarifyingTurnId(null);
      setError(null);
      setLoadState("loading");

      try {
        const detail = await getConversation(id);
        // A newer load (or a new conversation) superseded this one.
        if (seq !== loadSeqRef.current) {
          return;
        }
        setMessages(detail.messages.map(toChatMessage));
        setAnalyses(toAnalysisMap(detail.analyses));
        setLoadState("idle");
      } catch (err) {
        if (seq !== loadSeqRef.current) {
          return;
        }
        setLoadState("error");
        setError(errorMessage(err));
        if (err instanceof ApiError && err.status === 404) {
          void refreshConversations();
        }
      }
    },
    [refreshConversations],
  );

  const selectConversation = useCallback(
    (id: string) => {
      if (isActive) {
        return;
      }
      if (id === activeIdRef.current && loadState !== "error") {
        return;
      }
      void loadConversation(id);
    },
    [isActive, loadState, loadConversation],
  );

  const startNewConversation = useCallback(() => {
    if (isActive) {
      return;
    }
    loadSeqRef.current++;
    activeIdRef.current = null;
    setActiveId(null);
    setMessages([]);
    setAnalyses({});
    setClarifyingTurnId(null);
    setError(null);
    setLoadState("idle");
  }, [isActive]);

  const retryLoad = useCallback(() => {
    if (activeIdRef.current) {
      void loadConversation(activeIdRef.current);
    }
  }, [loadConversation]);

  // ── Reconciling with the server after a stream ends ─────────────────────────

  async function reconcile(conversationId: string): Promise<void> {
    void refreshConversations();

    const seq = ++loadSeqRef.current;

    for (let attempt = 0; attempt < RECONCILE_MAX_ATTEMPTS; attempt++) {
      try {
        const detail = await getConversation(conversationId);

        if (
          seq !== loadSeqRef.current ||
          activeIdRef.current !== conversationId
        ) {
          return;
        }

        // After a stop, the server may not have finalized the message yet.
        // Replacing local text with a still-`streaming` empty row would lose
        // what the user already saw, so wait and retry.
        if (detail.messages.every((m) => m.status !== "streaming")) {
          setMessages(detail.messages.map(toChatMessage));
          setAnalyses(toAnalysisMap(detail.analyses));
          setClarifyingTurnId(null);
          return;
        }
      } catch {
        // Keep the optimistic view; reopening the conversation re-reads it.
        return;
      }

      await sleep(RECONCILE_RETRY_MS * (attempt + 1));

      if (seq !== loadSeqRef.current) {
        return;
      }
    }
  }

  // ── Ending a turn ───────────────────────────────────────────────────────────

  function settleTurn(
    status: "completed" | "failed" | "cancelled",
    conversationId: string | null,
  ): void {
    const turn = activeTurnRef.current;

    abortRef.current = null;
    activeTurnRef.current = null;
    streamConversationIdRef.current = null;
    setPhase("idle");

    if (turn) {
      setMessages((current) =>
        current.map((m) =>
          m.id === turn.assistantId ? { ...m, status } : m,
        ),
      );
    }

    if (conversationId) {
      void reconcile(conversationId);
    } else {
      void refreshConversations();
    }
  }

  /** The request never produced a turn: drop optimistic messages, restore input. */
  function rollbackTurn(message: string | null): void {
    const turn = activeTurnRef.current;

    abortRef.current = null;
    activeTurnRef.current = null;
    streamConversationIdRef.current = null;
    setPhase("idle");

    if (turn) {
      setMessages((current) =>
        current.filter(
          (m) => m.id !== turn.userId && m.id !== turn.assistantId,
        ),
      );
      setDraft(turn.text);
    }

    if (message) {
      setError(message);
    }
  }

  // ── Sending ─────────────────────────────────────────────────────────────────

  function sendMessage(): void {
    const text = draft.trim();

    if (!text || isActive || loadState === "loading") {
      return;
    }

    // Invalidate any pending reconcile so it cannot overwrite this turn.
    loadSeqRef.current++;

    const turn: ActiveTurn = {
      userId: `local-user-${crypto.randomUUID()}`,
      assistantId: `local-assistant-${crypto.randomUUID()}`,
      text,
    };
    const controller = new AbortController();

    activeTurnRef.current = turn;
    abortRef.current = controller;
    streamConversationIdRef.current = activeIdRef.current;

    setDraft("");
    setError(null);
    setPhase("submitting");
    setMessages((current) => [
      ...current,
      {
        id: turn.userId,
        role: "user",
        content: text,
        status: "completed",
        turnId: null,
      },
      {
        id: turn.assistantId,
        role: "assistant",
        content: "",
        status: "streaming",
        turnId: null,
      },
    ]);

    streamConversationReply(
      { conversationId: activeIdRef.current, message: text },
      {
        onStart({ conversationId }) {
          streamConversationIdRef.current = conversationId;
          if (activeIdRef.current === null) {
            activeIdRef.current = conversationId;
            setActiveId(conversationId);
          }
        },

        onAnalysis({ turnId, needsClarification }) {
          // Link the optimistic messages to the server turn, and flag a
          // clarifying question. Constraints arrive with the next read.
          setMessages((current) =>
            current.map((m) =>
              m.id === turn.userId || m.id === turn.assistantId
                ? { ...m, turnId }
                : m,
            ),
          );
          setClarifyingTurnId(needsClarification ? turnId : null);
        },

        onDelta(delta) {
          setPhase("streaming");
          setMessages((current) =>
            current.map((m) =>
              m.id === turn.assistantId
                ? { ...m, content: m.content + delta }
                : m,
            ),
          );
        },

        onDone({ conversationId }) {
          settleTurn("completed", conversationId);
        },

        onError({ message, phase: errorPhase }) {
          if (errorPhase === "request") {
            rollbackTurn(message);
            return;
          }
          setError(message);
          settleTurn("failed", streamConversationIdRef.current);
        },
      },
      controller.signal,
    );
  }

  function stopGenerating(): void {
    const controller = abortRef.current;

    if (!controller) {
      return;
    }

    controller.abort();

    const conversationId = streamConversationIdRef.current;

    if (conversationId === null) {
      // Stopped before the server identified the conversation. A new
      // conversation may still have been created, so refresh the list.
      rollbackTurn(null);
      void refreshConversations();
      return;
    }

    settleTurn("cancelled", conversationId);
  }

  return {
    // Conversation list
    conversations,
    listLoading,
    listError,
    activeId,
    selectConversation,
    startNewConversation,

    // Active conversation
    messages,
    analyses,
    clarifyingTurnId,
    loadState,
    retryLoad,

    // Composer
    draft,
    setDraft,
    phase,
    error,
    sendMessage,
    stopGenerating,
  };
}
