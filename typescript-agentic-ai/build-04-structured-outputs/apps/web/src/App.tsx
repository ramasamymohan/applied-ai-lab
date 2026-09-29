import { useState } from "react";
import { Composer } from "./components/Composer";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { MessageList } from "./components/MessageList";
import { useChat } from "./hooks/useChat";
import "./App.css";

export default function App() {
  const chat = useChat();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isActive = chat.phase !== "idle";
  const activeConversation = chat.conversations.find(
    (conversation) => conversation.id === chat.activeId,
  );

  function handleSelect(id: string) {
    chat.selectConversation(id);
    setSidebarOpen(false);
  }

  function handleNew() {
    chat.startNewConversation();
    setSidebarOpen(false);
  }

  return (
    <main className="page">
      <div className="workspace">
        <ConversationSidebar
          conversations={chat.conversations}
          activeId={chat.activeId}
          loading={chat.listLoading}
          error={chat.listError}
          disabled={isActive}
          open={sidebarOpen}
          onSelect={handleSelect}
          onNew={handleNew}
          onClose={() => setSidebarOpen(false)}
        />

        <section className="chat" aria-labelledby="chat-title">
          <header className="chat-header">
            <button
              type="button"
              className="btn-menu"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open conversation list"
            >
              ☰
            </button>
            <div className="brand-mark" aria-hidden="true">
              S
            </div>
            <div className="chat-heading">
              <h1 id="chat-title">Storefront AI</h1>
              <p>
                {activeConversation?.title ??
                  (chat.activeId ? "Conversation" : "New conversation")}
              </p>
            </div>
            <span className="status">Build 03</span>
          </header>

          <MessageList
            messages={chat.messages}
            phase={chat.phase}
            loadState={chat.loadState}
            onRetryLoad={chat.retryLoad}
          />

          {chat.error && (
            <p className="error" role="alert">
              {chat.error}
            </p>
          )}

          <Composer
            draft={chat.draft}
            phase={chat.phase}
            loading={chat.loadState === "loading"}
            onDraftChange={chat.setDraft}
            onSend={chat.sendMessage}
            onStop={chat.stopGenerating}
          />

          <p className="disclaimer">
            AI-generated responses can be inaccurate. Verify important product
            details before making a decision.
          </p>
        </section>
      </div>
    </main>
  );
}
