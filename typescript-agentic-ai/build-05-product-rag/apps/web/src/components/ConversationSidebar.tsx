import type { ConversationSummary } from "../lib/api";

type ConversationSidebarProps = {
  conversations: ConversationSummary[];
  activeId: string | null;
  loading: boolean;
  error: string | null;
  /** True while a reply is generating — switching is blocked. */
  disabled: boolean;
  /** Mobile: whether the sidebar overlay is open. */
  open: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
};

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ConversationSidebar({
  conversations,
  activeId,
  loading,
  error,
  disabled,
  open,
  onSelect,
  onNew,
  onClose,
}: ConversationSidebarProps) {
  return (
    <aside
      className={`sidebar${open ? " sidebar--open" : ""}`}
      aria-label="Conversation history"
    >
      <div className="sidebar-header">
        <button
          type="button"
          className="btn-new"
          onClick={onNew}
          disabled={disabled}
        >
          + New conversation
        </button>
        <button
          type="button"
          className="btn-close-sidebar"
          onClick={onClose}
          aria-label="Close conversation list"
        >
          ×
        </button>
      </div>

      {error && (
        <p className="sidebar-note sidebar-note--error" role="alert">
          {error}
        </p>
      )}

      {loading && <p className="sidebar-note">Loading conversations…</p>}

      {!loading && !error && conversations.length === 0 && (
        <p className="sidebar-note">
          No conversations yet. Ask your first shopping question to start one.
        </p>
      )}

      <nav aria-label="Conversations">
        <ul className="conversation-list">
          {conversations.map((conversation) => {
            const isCurrent = conversation.id === activeId;

            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  className={`conversation-item${isCurrent ? " conversation-item--active" : ""}`}
                  aria-current={isCurrent ? "true" : undefined}
                  disabled={disabled && !isCurrent}
                  onClick={() => onSelect(conversation.id)}
                >
                  <span className="conversation-title">
                    {conversation.title || "Untitled conversation"}
                  </span>
                  <span className="conversation-time">
                    {formatUpdatedAt(conversation.updated_at)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {disabled && (
        <p className="sidebar-note">
          Switching is disabled while a reply is generating.
        </p>
      )}
    </aside>
  );
}
