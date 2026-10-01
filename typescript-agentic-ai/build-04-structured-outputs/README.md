# Build 04 — Structured Outputs & Reliable Model Contracts

Part of the **From Prompt to Platform** series. Each build in this series is a fully independent, standalone application.

> **Status: in progress — Commit 02 of 3.** This README describes what exists today and what is planned. Sections marked *(planned)* are not implemented yet.

---

## Objective

Make model output a **typed contract** instead of prose the application hopes to interpret. This build adds a reusable structured-generation layer and uses it first for *request understanding*: turning a shopper's message into a validated `ShoppingRequest` the application can act on.

This build does not add retrieval, tools, or agent loops. It builds the contract discipline those builds depend on.

## What changes from Build 03

| Concern | Build 03 | Build 04 |
|---|---|---|
| Model output | Free text only | Free text (streamed reply) + typed, validated structured results |
| Contracts | None | Zod schema is the single source of truth; provider JSON Schema derived from it |
| Failure handling | Streaming errors only | Named failure taxonomy for structured calls |
| Turn lifecycle | Stream reply | Analyze request, persist it, decide in application code, then reply |
| Persistence | conversations, messages | + `turn_analyses` (migration 002) |
| SSE events | delta, done, error | + optional `analysis` (additive) |
| UI | Chat | *(planned, Commit 03)* recognized constraints and clarification state |

Build 03 is unchanged and still independently runnable.

## Commit plan

| # | Scope | Status |
|---|---|---|
| 01 | Structured generation layer, failure taxonomy, repair retry, config, `ShoppingRequest` contract | Done |
| 02 | Request understanding in the turn lifecycle (`turn_analyses` table, `analysis` SSE event) | **Done (this commit)** |
| 03 | Frontend and documentation | Planned |

---

## Structured generation layer (Commit 01)

```
caller
  │  contract (Zod schema + name + version) + instructions + input
  ▼
StructuredGenerationService            apps/api/src/structured/
  │  1. call provider port
  │  2. classify outcome
  │  3. JSON.parse  →  contract.schema.safeParse   (always, even with strict mode)
  │  4. on parse/validation failure only: ONE repair retry, then stop
  ▼
StructuredResult  =  ok | refusal | incomplete | invalid | provider_error
  ▲
  │ StructuredModelProvider (port)
OpenAI Responses adapter               strict json_schema output format
```

### Files

| File | Responsibility |
|---|---|
| `structured/types.ts` | Provider port, raw outcomes, and the `StructuredResult` union |
| `structured/contract.ts` | `defineContract()`: derives strict-mode JSON Schema from Zod, rejects unsupported shapes at startup |
| `structured/structured-generation-service.ts` | Validation, failure taxonomy, bounded repair retry. Never throws |
| `structured/openai-structured-provider.ts` | OpenAI adapter: strict schema, refusal/incomplete detection, error classification |
| `structured/contracts/shopping-request.ts` | `ShoppingRequest` v1 contract |
| `services/request-analysis-service.ts` | Analysis prompt; maps every structured result to `completed` or `analysis_failed` |
| `services/turn-decision.ts` | Application-owned clarify-or-answer rule |
| `services/analysis-summary.ts` | Stored row to API summary, re-validating the payload |
| `repositories/turn-analysis-repository.ts` | SQL for `turn_analyses` |
| `services/conversation-service.ts` | Turn lifecycle: analyze, persist, decide, reply |


### Turn lifecycle (Commit 02)

```
POST /api/conversations/:id/messages
  │  transaction: user message + assistant placeholder (status = streaming)
  │  SSE headers sent immediately
  ▼
analyze request   (non-streaming structured call; recent turns as context)
  │  persist to turn_analyses  (completed | analysis_failed)
  │  emit SSE `analysis` (sanitized summary)
  ▼
decideTurn()      plain TypeScript, not model-driven
  ├── clarify → stream the clarifying question as the reply (no chat-model call)
  └── answer  → stream the model reply; analysis passed as a non-authoritative hint
```

Analysis runs **inside** the stream, after the headers are sent, so the connection opens at once and the `analysis` event arrives as soon as it is ready. The cost is that the first `delta` now waits for the analysis call; the route's existing `timeToFirstDeltaMs` log includes it, and the analysis call's own `latencyMs` is stored per turn.

Decision rules (`services/turn-decision.ts`):

| Analysis result | Application behavior |
|---|---|
| Failed, refused, truncated, invalid, or errored | Normal reply, no analysis context. Recorded as `analysis_failed`. The user sees no error |
| `needs_clarification` with a non-empty question, intent not `small_talk` | Reply with that question. The model is not called again |
| Anything else | Normal reply with the analysis as a hint inside `<request_analysis>` tags, marked as data and non-authoritative |

Small talk is never held up by a clarifying question, whatever the model flagged.

Cancellation during analysis cancels the provider call, skips persistence, and finalizes the assistant message as `cancelled`, as in Build 03.

If saving the analysis fails, the error is logged and the turn continues.

### Failure taxonomy

| Result | Meaning | Retried? | Intended caller behavior |
|---|---|---|---|
| `ok` | Parsed and passed Zod validation | n/a | Use `data`. `repaired` tells you whether the retry was needed |
| `invalid` (`json_parse`) | Text was not valid JSON | Once, if enabled | After retry: treat as analysis failed |
| `invalid` (`schema_validation`) | JSON failed the Zod contract | Once, if enabled | After retry: treat as analysis failed |
| `refusal` | Model declined | No | Treat as analysis failed; do not show refusal text verbatim |
| `incomplete` | Output cut off (token limit, content filter) | No | Treat as analysis failed; truncated output is never trusted |
| `provider_error` | Timeout, abort, rate limit, outage, unknown | No (SDK does one transport-level retry) | Treat as analysis failed; `aborted` means the caller cancelled |

Worst case is **two provider calls**, each bounded by `STRUCTURED_OUTPUT_TIMEOUT_MS`. There is no loop.

Repair prompts contain validation paths and rules, plus a truncated copy of the model's own invalid output. They never contain stored user data.

### Contract versioning

- Each contract has an integer `version` owned by the application, bumped on any change to a field's shape or meaning.
- The model is not asked to emit the version. The application applies it and persists it beside the stored result (`turn_analyses.contract_name` and `schema_version`).
- Readers of persisted data must handle every version ever stored.

### `ShoppingRequest` v1

```ts
{
  intent: "product_search" | "order_status" | "returns" | "policy_question" | "small_talk" | "other",
  category: string | null,
  budget: { max: number | null, currency: string | null },
  attributes: string[],              // e.g. "waterproof", "lightweight"
  needs_clarification: boolean,
  clarification_question: string | null,
}
```

Deviation from the plan's draft: `schema_version` is applied by the application through the contract, not requested from the model.

### Strict-mode constraints encountered

- All properties must be required; optional values are modeled as `nullable`. `defineContract()` throws if a schema has optional properties.
- Range, length, and format rules (`minimum`, `maxLength`, `pattern`, …) are not relied on in provider schemas. `defineContract()` throws if one appears. Those rules are written as Zod `.refine()` checks instead, which run in the application and never reach the provider. The provider constrains **shape**; the application enforces **meaning**.
- Cross-field rules (clarification question required exactly when `needs_clarification` is true) can only be enforced by Zod refinement.

> The exact set of keywords a given model accepts in strict mode changes over time. The disallowed list is deliberately conservative and should be re-checked against current provider documentation.

### Latency

The structured step is non-streaming and runs **before** the streamed reply, so it adds to time-to-first-token. Every result carries `latencyMs` (all attempts) so the cost is measured. Measurement approach and numbers will be documented in Commit 03 once there is something real to measure.

---

## Database

Migration 002 adds `turn_analyses`, one row per turn, keyed by `turn_id`:

| Column | Notes |
|---|---|
| turn_id | Primary key. Not a foreign key: in `messages`, `turn_id` is only unique together with `role` |
| conversation_id | FK to conversations, `ON DELETE CASCADE` |
| status | `completed` or `analysis_failed` |
| failure_kind | Short label such as `refusal`, `invalid:schema_validation`, `provider_error:timeout`; set only on failure |
| contract_name, schema_version | Which contract and version `payload` was written under |
| payload | JSONB `ShoppingRequest`; set only on `completed` |
| attempts, repaired, latency_ms | Provider calls made, whether the repair retry was needed, total wall-clock time |

A check constraint ties `payload` and `failure_kind` to `status`. Analysis lives in its own table so `messages` stays the UI's history.

```bash
cd apps/api
pnpm migrate        # fresh database: applies 001 and 002
pnpm migrate:002    # existing Build 03 database: applies 002 only
pnpm migrate:down   # drops all tables, including turn_analyses
```

Reading: stored payloads are re-validated on read against the contract they were written under. Rows with an unknown contract version or an invalid payload are left out of API responses rather than breaking the conversation.

---

## Environment variables

### API (`apps/api/.env`)

```
OPENAI_API_KEY=sk-...            # required — backend only
OPENAI_MODEL=gpt-4o-mini         # optional, default: gpt-4o-mini
PORT=3000                         # optional, default: 3000
WEB_ORIGIN=http://localhost:5173  # optional, default: http://localhost:5173
NODE_ENV=development              # optional, default: development
DATABASE_URL=postgresql://localhost:5432/storefront_ai  # required
MAX_CONTEXT_TURNS=10              # optional, default: 10

# New in Build 04
STRUCTURED_OUTPUT_MODEL=          # optional, default: OPENAI_MODEL. Must support strict structured outputs
STRUCTURED_OUTPUT_TIMEOUT_MS=15000       # optional, default: 15000 (1000–120000)
STRUCTURED_OUTPUT_MAX_TOKENS=512         # optional, default: 512 (64–4096)
ANALYSIS_CONTEXT_TURNS=2                 # optional, default: 2 (0–10). Recent completed turns given to the analyzer
STRUCTURED_OUTPUT_REPAIR_ENABLED=true    # optional, default: true ("true" | "false")
```

> **Security:** `OPENAI_API_KEY` belongs exclusively on the backend server. Never place it in `VITE_` variables or any browser-accessible code. A browser-exposed API key is compromised by design.

### Web (`apps/web/.env`)

```
VITE_API_BASE_URL=http://localhost:3000   # optional, default: http://localhost:3000
```

---

## API endpoints and SSE events

Request and response shapes are unchanged from Build 03 (see its README). Two additive changes:

### SSE: new optional `analysis` event

Sent at most once per stream, before any `delta`:

```
event: analysis
data: {"turnId":"…","status":"completed","intent":"product_search","needsClarification":false}
```

| Field | Meaning |
|---|---|
| status | `completed`, or `analysis_failed` (the reply still follows) |
| intent | Classified intent, or `null` when analysis failed |
| needsClarification | True when the application is replying with a clarifying question |

Existing `delta`, `done`, and `error` events are unchanged. Clients that do not know `analysis` can ignore it, and the Build 03 web client does.

A clarification turn streams as `analysis`, one `delta` containing the question, then `done`.

### GET /api/conversations/:conversationId: new `analyses` array

```json
{
  "conversation": {
    "id": "…", "title": "…", "messages": [ … ],
    "analyses": [
      {
        "turn_id": "…", "status": "completed", "schema_version": 1,
        "intent": "product_search", "category": "rain jackets",
        "budget": { "max": 150, "currency": "USD" },
        "attributes": ["waterproof"], "needs_clarification": false
      },
      { "turn_id": "…", "status": "analysis_failed" }
    ]
  }
}
```

Join to messages on `turn_id`. Summaries carry the recognized constraints, not failure details, latency, or raw model output. Field names are snake_case here to match the rest of this response, and camelCase in SSE events to match `done`. Here `needs_clarification` means the application asked a question, which can be narrower than the model's raw flag.

---

## Local setup

**Prerequisites:** Node.js 20+, pnpm 12+, PostgreSQL 15+, an OpenAI API key.

```bash
# API
cd apps/api
pnpm install
cp ../../.env.example .env     # then add OPENAI_API_KEY and DATABASE_URL
createdb storefront_ai
pnpm migrate                   # same schema as Build 03
pnpm dev                       # http://localhost:3000

# Web
cd apps/web
pnpm install
pnpm dev                       # http://localhost:5173
```

### Validation commands

```bash
cd apps/api && pnpm typecheck && pnpm build
cd apps/web && pnpm lint && pnpm build
```

---

## Known limitations

- Every turn now makes an extra non-streaming model call before the reply starts, adding latency and cost. There is no off switch in this commit.
- A failed analysis save is logged, not retried, so the `analysis` event and a later reload can disagree.
- Analysis rows from unknown contract versions are skipped on read, not migrated.
- The shopper's text and the model's interpretation (category, attributes) pass through the chat prompt; the interpretation is delimited and marked as non-authoritative, which mitigates but does not eliminate prompt injection.
- The web client does not use `analysis` or `analyses` yet (Commit 03).
- The classifier can be wrong, and nothing measures how often (Build 12).
- The intent taxonomy is hand-written and small.
- Structured outputs constrain shape, not truth.
- Provider API shapes in the OpenAI adapter were written from prior knowledge and must be verified against the installed `openai` version.
- Test files inherited from earlier builds (`apps/api/test/*`, `apps/web/src/App.test.tsx`, `apps/web/src/lib/api.test.ts`) are not maintained in this build and may be stale.
- Everything from the Build 03 limitation list that is not listed above still applies (no authentication, single-instance recovery, turn-count context limit, no RAG).

This build is not production-ready.

## Next constraint

The model now understands requests but still invents product details. It needs the real catalog (Build 05).
