# Build 03 — Conversation History & Persistent State

Part of the **From Prompt to Platform** series. Each build in this series is a fully independent, standalone application.

---

## What this build does

Build 02 streams model responses to the browser but treats every request independently — the model has no memory of previous messages, and refreshing the browser loses the conversation.

Build 03 introduces application-managed conversation state using PostgreSQL. Users can start conversations, browse previous conversations, reopen them after a browser refresh, and continue chatting with relevant history included as model context.

---

## What changes from Build 02

| Concern | Build 02 | Build 03 |
|---|---|---|
| Conversation state | Frontend memory only | PostgreSQL — source of truth |
| Model context | Single message, no history | Recent completed turns from DB |
| Persistence | Lost on refresh | Survives refresh, restart |
| Conversation identity | None | UUID per conversation |
| Message lifecycle | None | streaming → completed / failed / cancelled / interrupted |
| Recovery | None | Startup marks abandoned streaming as interrupted |
| API surface | POST /api/chat | Conversation CRUD + message streaming |

Build 02 is unchanged and still independently runnable.

---

## Current status

1. **PostgreSQL foundation** — schema, migrations, repositories, pool lifecycle, startup recovery.
2. **Conversation APIs and persistent streaming** — conversation endpoints, context-aware model calls, assistant messages finalized in the database.
3. **React conversation experience** — conversation sidebar, history reload after refresh, continuing a conversation, and stop/error handling that reconciles with the database.

### Frontend structure

```
apps/web/src
├── App.tsx                         layout: sidebar + chat
├── hooks/useChat.ts                conversation state, streaming, reconciliation
├── components/
│   ├── ConversationSidebar.tsx     list, select, new conversation
│   ├── MessageList.tsx             messages, status notes, empty/loading/error states
│   └── Composer.tsx                input, send, stop
└── lib/
    ├── api.ts                      JSON reads (Zod-validated) + SSE streaming client
    └── sse-parser.ts               incremental SSE parsing
```

The database is the source of truth. While a reply streams, the UI shows optimistic local messages. When the stream ends — completed, failed, or stopped — the conversation is re-read from the API so the view matches what was persisted.

Behavior to know about:

- **New conversations:** `POST /api/conversations` creates the conversation and streams the first reply. The new conversation's ID is returned in the `X-Conversation-Id` response header (exposed through CORS), so the UI knows it before any text arrives — even if the stream fails or is stopped.
- **Stop:** aborting the request makes the server cancel the provider call and finalize the message as `cancelled`, keeping the partial text.
- **Switching conversations** and starting a new one are disabled while a reply is generating.
- **Pre-stream failures** (validation, not found, 409 concurrent generation, rate limit) remove the optimistic messages and restore the draft in the input.
- **Mid-stream failures** keep the partial text, mark the message as failed, and show the error.

---

## Target architecture (full build)

```
React + TypeScript
  │
  │ Conversation list, history, chat UI
  │
  │ POST /api/conversations/:conversationId/messages
  ▼
Fastify API
  │
  ├── Conversation routes
  │
  ├── Conversation service
  │     │
  │     ├── Conversation repository
  │     │
  │     ├── Message repository
  │     │
  │     └── OpenAI streaming service
  │
  ├── PostgreSQL
  │     │
  │     ├── conversations
  │     │
  │     └── messages
  │
  └── OpenAI Responses API
        │
        └── Text deltas → Fastify SSE → React ReadableStream
```

PostgreSQL is the source of truth for conversation history. The model does not own the application's persistent state.

---

## API endpoints

### POST /api/conversations

Create a new conversation and stream the first assistant reply.

**Request:** `{ "message": "string" }`

**Response:** SSE stream (same wire format as the message endpoint below), with an `X-Conversation-Id` response header carrying the new conversation's ID.

The conversation title is derived from the first user message.

### GET /api/conversations

List conversations, most recently updated first.

**Response:** `{ "conversations": [{ "id", "title", "created_at", "updated_at" }] }`

### GET /api/conversations/:conversationId

Get a conversation with all its messages.

**Response:** `{ "conversation": { "id", "title", "created_at", "updated_at", "messages": [...] } }`

### POST /api/conversations/:conversationId/messages

Send a message in an existing conversation and stream the assistant reply.

**Request:** `{ "message": "string" }`

**Response:** SSE stream with events:

| Event | Data | Description |
|---|---|---|
| `delta` | `{ "text": "..." }` | Generated text fragment |
| `done` | `{ "conversationId": "...", "messageId": "..." }` | Successful completion. The message is already persisted as `completed` when this is sent. |
| `error` | `{ "message": "..." }` | Generation failure. The message is already persisted as `failed`. |

If the client disconnects mid-stream, the provider request is aborted and the message is persisted as `cancelled` with the partial text.

**Error responses (pre-stream):**

| Code | Condition |
|---|---|
| 400 | Invalid request body or conversation ID |
| 404 | Conversation not found |
| 409 | Another response is already being generated |
| 500 | Internal error |

---

## PostgreSQL setup

### Create the database

```bash
createdb storefront_ai
```

### Run the migration

```bash
cd apps/api
psql postgresql://localhost:5432/storefront_ai -f migrations/001_create-conversations-and-messages.sql
```

Or using the package script (requires `DATABASE_URL` in your environment or `.env`):

```bash
pnpm migrate
```

### Rollback

```bash
pnpm migrate:down
```

---

## Database schema

### conversations

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key, generated |
| title | TEXT | Derived from first user message |
| created_at | TIMESTAMPTZ | Set on creation |
| updated_at | TIMESTAMPTZ | Updated on each turn |

### messages

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key, generated |
| conversation_id | UUID | FK → conversations.id (CASCADE) |
| turn_id | UUID | Pairs user + assistant in one exchange |
| role | TEXT | 'user' or 'assistant' |
| content | TEXT | Message text |
| status | message_status | completed / streaming / failed / cancelled / interrupted |
| created_at | TIMESTAMPTZ | Set on creation |
| updated_at | TIMESTAMPTZ | Updated on status change |

### Key constraints

- **`uq_messages_turn_role`** — One message per role within a turn.
- **`uq_messages_active_streaming`** — Partial unique index: at most one streaming assistant message per conversation.
- **`idx_messages_conversation_created`** — Chronological message retrieval.
- **`idx_conversations_updated_at`** — Conversation list ordering.

---

## Environment variables

### API (`apps/api/.env`)

```
OPENAI_API_KEY=sk-...            # required — backend only
OPENAI_MODEL=gpt-6-luna         # optional, default: gpt-6-luna
PORT=3000                         # optional, default: 3000
WEB_ORIGIN=http://localhost:5173  # optional, default: http://localhost:5173
NODE_ENV=development              # optional, default: development
DATABASE_URL=postgresql://localhost:5432/storefront_ai  # required
MAX_CONTEXT_TURNS=10              # optional, default: 10
```

> **Security:** `OPENAI_API_KEY` belongs exclusively on the backend server. Never place it in `VITE_` variables or any browser-accessible code.

### Web (`apps/web/.env`)

```
VITE_API_BASE_URL=http://localhost:3000   # optional, default: http://localhost:3000
```

---

## Local setup

**Prerequisites:** Node.js 20+, pnpm 12+, PostgreSQL 15+, an OpenAI API key.

### API

```bash
cd apps/api
pnpm install
cp .env.example .env     # then add OPENAI_API_KEY and DATABASE_URL
pnpm migrate             # apply the database schema
pnpm dev
```

Starts on `http://localhost:3000`.

### Web

```bash
cd apps/web
pnpm install
pnpm dev
```

Starts on `http://localhost:5173`.

---

## Development commands

### API

```bash
cd apps/api
pnpm dev          # tsx watch — auto-restarts on changes
pnpm typecheck    # tsc --noEmit
pnpm test         # Node built-in test runner
pnpm build        # tsc → dist/
pnpm migrate      # apply SQL migrations
pnpm migrate:down # rollback migrations
```

### Web

```bash
cd apps/web
pnpm dev          # Vite dev server
pnpm lint         # oxlint
pnpm build        # tsc -b (typecheck) + Vite production build → dist/
```

---

## Recovery behavior

On startup, the server marks any assistant messages left in `streaming` status as `interrupted`. This handles the case where a previous process terminated abruptly during generation.

Limitations:

- Assumes a single application instance. Multi-instance coordination is not implemented.
- Partial text accumulated only in application memory is lost after an abrupt termination. Unless periodic persistence is added, only text that reached a terminal state before the crash survives.

---

## Known limitations

- No user authentication or conversation ownership — every browser sees every conversation.
- No resuming or re-attaching to a reply that is still generating; a reply cut off by a closed tab is stored as `cancelled`.
- Conversation switching is blocked while a reply generates (no concurrent per-conversation streams in the UI).
- Message and conversation lists are not paginated.
- Build 03 adds no automated tests (out of scope for this build). Test files inherited from Build 02 (`apps/api/test/*`, `apps/web/src/App.test.tsx`, `apps/web/src/lib/api.test.ts`) target the Build 02 contracts and are not maintained here.
- No token-aware context budgeting — uses a turn-count limit.
- No automatic conversation summarization.
- No RAG or product knowledge retrieval.
- No multi-instance active-generation coordination.
- No conversation search, rename, or deletion.

This build is not production-ready. These limitations are addressed in later builds.

---

## Next steps

The next constraint this build exposes: conversation history grows without bound, and a turn-count limit is a blunt way to fit it into the model's context window. Token-aware context budgeting and summarization are left to a later build.
