# Storefront AI — Backend API

The Fastify backend for **Build 01: Basic Chat** in the TypeScript Agentic AI series.

Storefront AI's backend is responsible for:
- **Credential protection:** The OpenAI API key lives here, never in browser code
- **Request validation:** Incoming messages are validated with Zod
- **Provider integration:** Direct calls to the OpenAI SDK
- **Error handling:** Distinguishing user and system errors, returning sensible HTTP responses
- **Rate limiting:** Protecting the backend from abuse
- **Logging:** Structured logs for debugging and observability

## Tech Stack

- **Fastify** — HTTP server
- **TypeScript** — Type safety
- **Zod** — Runtime request and response validation
- **OpenAI SDK** — Provider API integration
- **Vitest** — Unit and integration tests

## Prerequisites

- Node.js (18+ recommended)
- pnpm
- An OpenAI API key

## Getting Started

### 1. Install dependencies

From the root build directory or the API directory:

```bash
pnpm install
```

### 2. Configure environment variables

Create `.env` in `apps/api/`:

```env
OPENAI_API_KEY=sk-...your-key-here...
MODEL=gpt-6-luna
WEB_ORIGIN=http://localhost:5173
PORT=3000
```

**`OPENAI_API_KEY`** — Your OpenAI API key. Never commit this.

**`MODEL`** — Model name to use for generations (e.g., `gpt-6-luna`, `gpt-4o`).

**`WEB_ORIGIN`** — CORS origin for the frontend. In development, `http://localhost:5173`.

**`PORT`** — Server port. Defaults to 3000.

See `.env.example` for all available variables.

### 3. Start the development server

```bash
pnpm dev
```

You should see Fastify startup logs:

```
[12:34:56.789] INFO: Server listening on http://0.0.0.0:3000
```

### 4. Verify the health endpoint

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{
  "status": "ok"
}
```

## Available Scripts

Run these commands from `apps/api/`.

| Command | Description |
|---|---|
| `pnpm dev` | Starts the Fastify dev server with hot reload |
| `pnpm build` | Compiles TypeScript to `dist/` |
| `pnpm preview` | Runs the compiled code (production-like) |
| `pnpm test` | Runs integration tests |

## API Endpoints

### POST `/api/chat`

Generate a response from the model.

**Request:**

```http
POST /api/chat HTTP/1.1
Content-Type: application/json

{
  "message": "What should I look for in a laptop?"
}
```

**Validation rules:**
- `message` must be a non-empty string
- Maximum 4000 characters
- Leading/trailing whitespace is trimmed

**Success response (200 OK):**

```json
{
  "reply": "Consider the processor, RAM, storage, battery life, and intended use…"
}
```

**Client error (400 Bad Request):**

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Enter a message of up to 4000 characters."
  }
}
```

**Server error (502 Bad Gateway):**

When the upstream provider fails:

```json
{
  "error": {
    "code": "MODEL_REQUEST_FAILED",
    "message": "The assistant is temporarily unavailable. Please try again."
  }
}
```

### GET `/api/health`

Health check endpoint.

**Response:**

```json
{
  "status": "ok"
}
```

## Architecture

### Request Flow

1. Frontend sends `POST /api/chat` with a message
2. Route handler validates with `ChatRequestSchema` (Zod)
3. Invalid requests return `400` immediately
4. Valid requests pass to `ChatService.generateReply()`
5. Service calls `client.responses.create()` with the message
6. Response is extracted, trimmed, and returned
7. Errors are logged and return `502`

### Code Organization

- **`app.ts`** — Fastify app setup with CORS, rate limiting, and route registration
- **`config.ts`** — Environment variable loading and validation
- **`routes/chat.ts`** — HTTP endpoint definitions and request contracts
- **`services/chat-service.ts`** — Business logic for LLM interaction
- **`server.ts`** — Entry point that starts the server

### Request Validation (Zod)

Incoming messages are validated with a strict schema:

```typescript
const ChatRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Message cannot be empty.")
    .max(4000, "Message must be 4000 characters or fewer."),
}).strict();
```

The `.strict()` call rejects unexpected properties, preventing accidental data leaks or misuse.

### Provider Integration

The backend uses the OpenAI SDK's `Responses` API:

```typescript
const response = await client.responses.create({
  model: options.model,
  instructions: SYSTEM_INSTRUCTIONS,
  input: message,
});

const reply = response.output_text.trim();
```

The system instructions define Storefront AI's behavior: helpful, honest about data limitations, and product-focused.

## Testing

Run the integration test suite:

```bash
pnpm test
```

Tests validate:
- Valid message submission and response
- Validation errors for invalid input
- Error handling for provider failures

## Security Considerations

**API Key Management:**
- Store `OPENAI_API_KEY` in a secrets manager, never in version control
- Use environment variables in production (e.g., AWS Secrets Manager, HashiCorp Vault)
- Rotate keys periodically
- Monitor for unauthorized access

**Request Validation:**
- All input is validated with Zod before processing
- Message size is limited to 4000 characters
- Unexpected properties are rejected

**Rate Limiting:**
- Per-IP rate limit: 30 requests per minute
- Protects against abuse and runaway requests
- Consider per-user limits in production

**Error Handling:**
- User errors (bad input) return `400`
- Provider errors return `502` with a generic message
- Internal errors are logged but not exposed to the client
- Avoid leaking provider details or stack traces

**CORS:**
- Configured to accept requests only from `WEB_ORIGIN`
- Prevents cross-origin abuse

## Production Concerns

**Timeouts:**
- Provider requests have a 30-second timeout
- Consider shorter timeouts for interactive chat
- Add timeout handling to the frontend

**Monitoring:**
- Structured logging is enabled (`logger: true` in Fastify)
- Add metrics for request latency, error rates, and token usage
- Monitor costs per request

**Retries:**
- The OpenAI SDK is configured with `maxRetries: 1` for transient failures
- Consider idempotency tokens for production (not yet implemented)

**Scaling:**
- Single-threaded Node.js process can handle ~100-200 concurrent requests
- For higher load, consider a load balancer and multiple instances
- Database and session storage are not yet implemented

## What's Not Here Yet

- **Conversation persistence** — no database; each request is independent
- **User authentication** — no auth or user tracking
- **Streaming responses** — responses are returned whole after generation
- **Token usage tracking** — costs are not logged per request
- **Caching** — responses are not cached
- **Tool calling** — no integration with business systems

These are added incrementally in future builds.

## Troubleshooting

**"OPENAI_API_KEY is required"**
- Create `.env` in `apps/api/` with a valid key
- Restart the server after changing `.env`

**"Server listening on http://0.0.0.0:3000"** but requests fail
- Ensure the frontend is configured to use `http://localhost:3000`
- Check CORS: frontend origin must match `WEB_ORIGIN` in `.env`

**502 errors from the provider**
- Verify your API key is correct
- Check OpenAI's status page
- Review rate limits and quota usage in your OpenAI account

**Tests fail**
- Mock the OpenAI SDK (not currently done; add before production)
- Check environment variables are set correctly

## Related Resources

- **Series repository:** `typescript-agentic-ai/`
- **Frontend application:** `apps/web/README.md`
- **Build documentation:** `../README.md`
- **OpenAI API documentation:** `https://platform.openai.com/docs`
