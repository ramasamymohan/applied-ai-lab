# Build 01 — Basic LLM Chat

Part of the **From Prompt to Platform** series.

**Related article:** [Designing a Production Agentic AI System in TypeScript](https://medium.com/@ramasamymohan/designing-a-production-agentic-ai-system-typescript-5f1e4f7a12df)

## What We're Building

A minimal but production-conscious AI chat application: React frontend → Fastify backend → OpenAI provider.

The application establishes the server-side boundary for credential protection and request validation. The LLM provider interaction lives exclusively on the backend. The frontend never touches API keys or calls the provider directly.

## The Production Problem This Solves

A browser-exposed API key is compromised by design. The first production requirement is a server-side boundary that:
- Protects provider credentials
- Validates and sanitizes requests
- Enforces rate limits and size limits
- Handles errors and logs appropriately
- Remains responsible for all access control and data handling

The model helps generate responses; the application controls everything else.

## Architecture

```
React Frontend (localhost:5173)
        ↓ /api/chat (JSON)
Fastify Backend (localhost:3000)
        ├─ Zod validation
        ├─ Rate limiting
        ├─ Error handling
        └─ OpenAI SDK
             ↓
        OpenAI API
```

## Stack

- **Frontend:** React + TypeScript + Vite
- **Backend:** Node.js + Fastify + TypeScript
- **Validation:** Zod (request validation, response contracts)
- **Provider:** OpenAI SDK (Responses API)
- **Package manager:** pnpm

## Prerequisites

- **Node.js** (18+ recommended; use LTS)
- **pnpm** (`npm install -g pnpm`)
- **OpenAI API key** (`https://platform.openai.com/account/api-keys`)

## Quick Start

### 1. Clone and install dependencies

```bash
cd typescript-agentic-ai/build-01-basic-chat
pnpm install
```

### 2. Configure the backend

Create `.env` in `apps/api/`:

```env
OPENAI_API_KEY=your_key_here
MODEL=gpt-6-luna
WEB_ORIGIN=http://localhost:5173
```

See `.env.example` for required variables.

### 3. Start the backend

```bash
pnpm -F api dev
```

The API will listen on `http://localhost:3000`. You should see Fastify startup logs.

### 4. Start the frontend (in another terminal)

```bash
pnpm -F web dev
```

The React dev server will open at `http://localhost:5173`.

### 5. Test the chat

Open the frontend, type a message, and confirm the response appears.

## What This Build Includes

- ✅ Chat interface with message submission
- ✅ Backend request validation (Zod)
- ✅ Server-side LLM provider integration
- ✅ Error handling and HTTP status codes
- ✅ CORS and rate limiting
- ✅ Request size limits
- ✅ Basic logging

## What's Not Here Yet

- ❌ **Streaming responses** — responses arrive only after generation completes
- ❌ **Conversation memory** — each request is stateless
- ❌ **Persistent state** — no database
- ❌ **Product knowledge** — no retrieval or embeddings
- ❌ **Tools or actions** — no integration with business systems
- ❌ **Multi-step workflows** — no orchestration or agent loop
- ❌ **Observability** — minimal tracing or detailed metrics
- ❌ **Production hardening** — timeouts, retries, and cost controls are minimal

These are introduced incrementally as requirements emerge.

## Project Structure

```
build-01-basic-chat/
├── apps/
│   ├── api/              # Fastify backend
│   │   ├── src/
│   │   │   ├── app.ts           # Express-like app setup
│   │   │   ├── config.ts        # Environment variables
│   │   │   ├── routes/chat.ts   # POST /api/chat endpoint
│   │   │   └── services/        # Business logic
│   │   └── test/                # Integration tests
│   └── web/              # React frontend
│       └── src/
│           ├── App.tsx          # Chat interface
│           ├── lib/api.ts       # Backend client
│           └── main.tsx         # Entry point
├── .env.example         # Template for backend config
└── README.md            # This file
```

## Running Tests

```bash
pnpm -F api test
```

A simple integration test validates the `/api/chat` endpoint and error handling.

## Environment Variables

See `.env.example` for required variables:

- `OPENAI_API_KEY` — Your OpenAI API key (backend only)
- `MODEL` — Model name (e.g., `gpt-6-luna`)
- `WEB_ORIGIN` — CORS origin for the frontend (e.g., `http://localhost:5173`)

Never commit actual credentials. Use `.env` locally and a secrets manager in production.

## Production Lens: What Matters Now

Before shipping this to users, consider:

- **Secrets:** Store API keys in a secrets manager, not in `.env` files
- **Timeouts:** Backend requests to the provider can hang; add timeouts
- **Rate limits:** Per-IP rate limiting is in place, but consider per-user limits
- **Errors:** Distinguish user errors (bad input) from system errors (provider down)
- **Monitoring:** Add structured logging and basic traces for debugging
- **Costs:** Monitor token usage to catch runaway requests or abuse
- **Latency:** Measure time-to-response and first-chunk latency (matters more in Part 2)

## What Breaks Next

Order status requests, inventory checks, and policy questions each return "I don't have access to that data." The next constraint is **streaming responses**: users wait for the full response before seeing anything. Partial output would improve UX significantly.

**Part 2** introduces end-to-end streaming: the backend forwards chunks from the provider to the frontend in real time, allowing the UI to render text as it arrives.

## Reproducing This Build

1. `git clone <repo>`
2. `cd typescript-agentic-ai/build-01-basic-chat`
3. `pnpm install`
4. Configure `.env` as described above
5. `pnpm -F api dev` in one terminal
6. `pnpm -F web dev` in another
7. Open `http://localhost:5173`

## See Also

- **API README:** `apps/api/README.md` — Backend architecture and request contracts
- **Web README:** `apps/web/README.md` — Frontend architecture and API integration
- **Series repository:** `typescript-agentic-ai/` — All builds in the series
- **Project documentation:** `applied-ai-lab/` — Series vision and roadmap
