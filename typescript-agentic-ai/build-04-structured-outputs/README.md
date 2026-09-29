# Build 04 — Structured Outputs & Reliable Model Contracts

Part of the **From Prompt to Platform** series. Each build in this series is a fully independent, standalone application.

> **Status: in progress — Commit 01 of 3.** This README describes what exists today and what is planned. Sections marked *(planned)* are not implemented yet.

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
| Turn lifecycle | Stream reply | *(planned, Commit 02)* analyze request, then decide, then reply |
| UI | Chat | *(planned, Commit 03)* recognized constraints and clarification state |

Build 03 is unchanged and still independently runnable.

## Commit plan

| # | Scope | Status |
|---|---|---|
| 01 | Structured generation layer, failure taxonomy, repair retry, config, `ShoppingRequest` contract | **Done (this commit)** |
| 02 | Request understanding in the turn lifecycle (`turn_analyses` table, `analysis` SSE event) | Planned |
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

The service is **not wired into any route yet**. Commit 02 connects it to the turn lifecycle.

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
- The model is not asked to emit the version. The application applies it and persists it beside the stored result (Commit 02).
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

The structured step is non-streaming and, once wired in Commit 02, runs **before** the streamed reply, so it adds to time-to-first-token. Every result carries `latencyMs` (all attempts) so the cost is measured. Measurement approach and numbers will be documented in Commit 03 once there is something real to measure.

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
STRUCTURED_OUTPUT_REPAIR_ENABLED=true    # optional, default: true ("true" | "false")
```

> **Security:** `OPENAI_API_KEY` belongs exclusively on the backend server. Never place it in `VITE_` variables or any browser-accessible code. A browser-exposed API key is compromised by design.

### Web (`apps/web/.env`)

```
VITE_API_BASE_URL=http://localhost:3000   # optional, default: http://localhost:3000
```

---

## API endpoints and SSE events

Unchanged from Build 03 in this commit. See the Build 03 README for request/response examples. Commit 02 will add an optional `analysis` SSE event and extend `GET /api/conversations/:id`; existing events keep their meaning.

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

- The structured layer is not connected to the chat flow yet (Commit 02).
- Structured output adds a model call and latency to every turn once wired in.
- The classifier can be wrong, and nothing measures how often (Build 12).
- The intent taxonomy is hand-written and small.
- Structured outputs constrain shape, not truth.
- Provider API shapes in the OpenAI adapter were written from prior knowledge and must be verified against the installed `openai` version.
- Test files inherited from earlier builds (`apps/api/test/*`, `apps/web/src/App.test.tsx`, `apps/web/src/lib/api.test.ts`) are not maintained in this build and may be stale.
- Everything from the Build 03 limitation list that is not listed above still applies (no authentication, single-instance recovery, turn-count context limit, no RAG).

This build is not production-ready.

## Next constraint

The model now understands requests but still invents product details. It needs the real catalog (Build 05).
