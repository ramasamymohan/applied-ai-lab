# Build 02 — Streaming LLM Responses End-to-End

Part of the **From Prompt to Platform** series. Each build in this series is a fully independent, standalone application.

---

## What this build does

Build 01 sent a request and waited for the complete model response before displaying anything. Build 02 makes responses appear as the model generates them.

The user sends a message. Text appears word by word. A Stop button cancels generation early. If generation fails after streaming has started, the error appears inline rather than replacing partial output.

---

## What changed from Build 01

| Layer | Build 01 | Build 02 |
|---|---|---|
| API response | JSON: `{ reply: string }` | SSE stream: `delta` / `done` / `error` events |
| Backend service | `generateReply()` → `Promise<string>` | `streamReply()` → `AsyncIterable<StreamEvent>` |
| Frontend client | `fetch` + `response.json()` | `fetch` + `ReadableStream` + SSE parser |
| UI states | idle / loading / error | idle / submitting / streaming / completed / cancelled / error |
| Cancellation | AbortSignal on fetch | AbortController → abort fetch → cancel provider stream |

Build 01 is unchanged and still independently runnable.

---

## Architecture

```
React UI
  │
  │  POST /api/chat  { message: string }
  ▼
Fastify route
  │  Zod validation (pre-stream — returns HTTP 400 if invalid)
  │
  │  Commits SSE headers: 200 text/event-stream
  ▼
ChatStreamingService.streamReply()
  │
  │  OpenAI Responses API  client.responses.stream()
  │  ← text delta events
  ▼
formatSseEvent()  →  reply.raw.write(frame)
  │
  │  HTTP response body (chunked)
  ▼
React  fetch() + ReadableStream + TextDecoder (stream mode)
  │
  │  SseParser  (persistent buffer, handles chunk boundaries)
  ▼
onDelta() → append text to message
onDone()  → mark complete
onError() → display inline error
```

---

## SSE event contract

Each event follows the SSE wire format:

```
event: <name>\r\n
data: <JSON payload>\r\n
\r\n
```

### delta

Carries newly generated text. Zero or more per stream.

```
event: delta
data: {"text":"Hello, "}
```

### done

Marks successful completion. Exactly one, after all deltas.

```
event: done
data: {}
```

### error

Sent when generation fails after streaming has started. The HTTP headers are already committed; this is the only way to signal failure.

```
event: error
data: {"message":"The assistant is temporarily unavailable. Please try again."}
```

A successful stream: `delta* done`  
A failed stream: `delta* error`  
A cancelled stream: no terminal event (client closes the connection)

---

## Pre-stream vs mid-stream errors

| When | Transport | Example |
|---|---|---|
| Before streaming starts | HTTP 400 JSON | Validation failure |
| After streaming starts | SSE `error` event | Provider failure during generation |

The HTTP status code is committed when the first byte of the SSE response is written. After that point it cannot change, so the error event carries the failure signal.

---

## Cancellation

The user can click Stop at any time during generation.

1. `AbortController.abort()` is called.
2. The fetch request is aborted.
3. The backend detects the closed connection via `reply.raw.on("close")`.
4. The backend calls `stream.cancel()` on the OpenAI provider stream.
5. No further events are written to the response.

The partial response text is preserved in the UI. The cancelled state is distinct from an error.

---

## Local setup

**Prerequisites:** Node.js 20+, pnpm 12+, an OpenAI API key.

Both apps (`apps/api` and `apps/web`) are fully independent — no root-level workspace.

### API

```bash
cd apps/api
pnpm install
cp .env.example .env     # then add your OPENAI_API_KEY
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

## Environment variables

### API (`apps/api/.env`)

```
OPENAI_API_KEY=sk-...     # required — backend only, never exposed to the browser
OPENAI_MODEL=gpt-4o-mini  # optional, default: gpt-4o-mini
PORT=3000                  # optional, default: 3000
WEB_ORIGIN=http://localhost:5173  # optional, default: http://localhost:5173
NODE_ENV=development       # optional, default: development
```

> **Security:** `OPENAI_API_KEY` belongs exclusively on the backend server. Never place it in `VITE_` variables or any browser-accessible code. A browser-exposed API key is compromised by design.

### Web (`apps/web/.env`)

```
VITE_API_BASE_URL=http://localhost:3000   # optional, default: http://localhost:3000
```

---

## Development commands

### API

```bash
cd apps/api
pnpm dev          # tsx watch — auto-restarts on changes
pnpm typecheck    # tsc --noEmit
pnpm test         # Node built-in test runner
pnpm build        # tsc → dist/
```

### Web

```bash
cd apps/web
pnpm dev          # Vite dev server
pnpm typecheck    # tsc --noEmit
pnpm test         # Vitest
pnpm lint         # oxlint
pnpm build        # Vite production build → dist/
```

---

## File structure

```
build-02-streaming/
├── .env.example
├── README.md
└── apps/
    ├── api/
    │   ├── src/
    │   │   ├── streaming/
    │   │   │   ├── sse.ts                   # SSE event types + serializer
    │   │   │   └── chat-streaming-service.ts # OpenAI streaming service
    │   │   ├── routes/
    │   │   │   └── chat.ts                  # POST /api/chat (SSE)
    │   │   ├── app.ts
    │   │   ├── config.ts
    │   │   └── server.ts
    │   └── test/
    │       ├── app.test.ts
    │       └── sse.test.ts
    └── web/
        └── src/
            ├── lib/
            │   ├── api.ts         # streamChatMessage() — streaming fetch client
            │   ├── api.test.ts
            │   ├── sse-parser.ts  # SSE buffer + event parser
            └── App.tsx
```

---

## Manual smoke test

1. Start both API and web apps.
2. Type a message and click Send.
3. Text appears progressively as the model generates it.
4. Click Stop mid-generation — partial text is preserved, the stream ends.
5. Submit a message over 4000 characters — the UI shows a validation error immediately (no stream started).
6. Stop the API server, then submit — the UI shows a connection error.

---

## Known limitations

- No conversation history — each message is a fresh context window.
- No authentication — suitable for local development only.
- No automatic retry — a failed stream requires the user to resend.
- Markdown in model output is displayed as plain text.
- No timeout UI — a very slow model response shows no elapsed-time feedback.

These limitations are addressed in later builds.

---

## Next constraint

Build 02 treats every request independently. The model has no memory of previous messages. Build 03 introduces conversation history and persistent session state.
