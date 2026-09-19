# Build 02 — Streaming

**Series:** From Prompt to Platform  
**Part 2 of 13**

> **Status:** Baseline established — streaming not yet implemented.  
> This directory is the starting point for Build 02. It is a clean copy of  
> Build 01 (stateless JSON chat). Streaming is introduced incrementally  
> across the remaining commits in this build.

---

## What this build adds

Build 01 returns the entire model response as a single JSON payload. The
user sees nothing until the model finishes generating — a full-round-trip
wait that grows with response length.

Build 02 replaces that with **end-to-end streaming over SSE**:

- The API switches from `client.responses.create()` to
  `client.responses.stream()` and writes newline-delimited SSE frames
  to the response as tokens arrive.
- The frontend reads the stream with the `EventSource`-compatible
  `fetch` + `ReadableStream` API, appending each token to the message
  in real time.
- Three event types carry the protocol: `delta` (new text), `done`
  (stream finished), and `error` (safe user-facing message).

No conversation state, no tool calls, no persistence — those come later.

---

## Architecture

```
Browser                    Fastify API              OpenAI
  │                            │                      │
  │  POST /api/chat            │                      │
  │  { "message": "..." }      │                      │
  ├──────────────────────────► │                      │
  │                            │  responses.stream()  │
  │                            ├─────────────────────►│
  │  Content-Type:             │                      │
  │  text/event-stream         │  token…token…done    │
  │◄───────────────────────────┤◄─────────────────────┤
  │                            │                      │
  │  event: delta              │                      │
  │  data: {"text":"Hi"}       │                      │
  │  …                         │                      │
  │  event: done               │                      │
  │  data: {}                  │                      │
```

---

## Repository structure

```
build-02-streaming/
├── .env.example                 # Environment variable reference
├── README.md                    # This file
└── apps/
    ├── api/                     # Fastify backend
    │   ├── package.json
    │   ├── pnpm-workspace.yaml
    │   ├── tsconfig.json
    │   ├── src/
    │   │   ├── app.ts           # Fastify app factory
    │   │   ├── config.ts        # Zod-validated environment config
    │   │   ├── server.ts        # Process entry point
    │   │   ├── routes/
    │   │   │   └── chat.ts      # POST /api/chat route
    │   │   └── services/
    │   │       └── chat-service.ts  # OpenAI integration
    │   └── test/
    │       └── app.test.ts      # Node built-in test runner
    └── web/                     # React + Vite frontend
        ├── package.json
        ├── vite.config.ts
        ├── index.html
        ├── public/
        │   ├── favicon.svg
        │   └── icons.svg
        └── src/
            ├── App.tsx
            ├── App.css
            ├── index.css
            ├── main.tsx
            ├── lib/
            │   └── api.ts       # HTTP client (streaming in later commits)
            └── test/
                └── setup.ts
```

Each app (`api`, `web`) is a fully independent pnpm project with its own
`package.json` and `pnpm-lock.yaml`. There is no root-level pnpm workspace.

---

## Getting started

### API

```bash
cd apps/api
pnpm install

# Create apps/api/.env — see .env.example for all variables
# OPENAI_API_KEY is required; never put it in the frontend

pnpm dev          # tsx watch mode, restarts on save
pnpm typecheck    # tsc --noEmit
pnpm test         # Node built-in test runner
pnpm build        # Compile to dist/
```

### Web

```bash
cd apps/web
pnpm install

pnpm dev          # Vite dev server on http://localhost:5174
pnpm typecheck    # tsc -b (project references)
pnpm lint         # oxlint
pnpm test         # vitest run
pnpm build        # Type-check + Vite production build
```

> **Note:** The web dev server runs on port 5174 (not the default 5173)
> to avoid collisions when running both builds side-by-side.

---

## Security note

The OpenAI API key belongs exclusively on the backend. It is loaded from
the server's `.env` file, validated by Zod at startup, and never reaches
the browser. The frontend communicates with the API over SSE — no key,
no SDK, no direct provider calls in browser code.

---

## Related

- [Build 01 — Basic Chat](../build-01-basic-chat/README.md)
- [Series overview](../../README.md)
