# Storefront AI — Web Frontend

The React frontend for **Build 01: Basic Chat** in the TypeScript Agentic AI series.

Storefront AI is a chat interface that communicates with a backend API. The backend handles all LLM provider interaction; the frontend never calls the provider directly or holds API credentials.

## Tech Stack

- **React** — UI components and application state
- **TypeScript** — Type safety
- **Vite** — Development server and build tooling
- **Zod** — Runtime validation of API responses
- **Fetch API** — HTTP communication with the backend

## Prerequisites

- Node.js (18+ recommended)
- pnpm
- The Storefront AI backend running locally on `http://localhost:3000`

## Getting Started

### 1. Install dependencies

From the root build directory or the web app directory:

```bash
pnpm install
```

### 2. Configure the backend API URL

Create `.env.development` in `apps/web/`:

```env
VITE_API_BASE_URL=http://localhost:3000
```

This points the frontend to your local Fastify backend.

**Important:** Vite exposes environment variables prefixed with `VITE_` to client-side code. Never place API keys, secrets, or sensitive credentials in `VITE_` variables. Long-lived provider API keys belong exclusively on the backend.

### 3. Start the development server

```bash
pnpm dev
```

Vite will print a local URL (usually `http://localhost:5173`). Open it in your browser.

The backend must be running at `http://localhost:3000` before you can send messages.

## Available Scripts

Run these commands from `apps/web/`.

| Command | Description |
|---|---|
| `pnpm dev` | Starts the Vite dev server with hot reload |
| `pnpm build` | Type-checks and builds for production |
| `pnpm preview` | Serves the production build locally |

## API Contract

The frontend communicates with the backend through a simple JSON API.

### Request

```http
POST /api/chat HTTP/1.1
Content-Type: application/json

{
  "message": "What should I look for in a laptop?"
}
```

### Success Response (200)

```json
{
  "reply": "Consider the processor, RAM, storage, battery life, and intended use…"
}
```

### Error Response (400 or 502)

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Enter a message of up to 4000 characters."
  }
}
```

The API client in `src/lib/api.ts`:
- Validates all responses against expected schemas (Zod)
- Handles HTTP errors and network failures
- Supports request cancellation via `AbortSignal`

## Architecture

### Component Structure

- **App.tsx** — Main chat component, manages messages and input state
- **lib/api.ts** — HTTP client and response validation
- **App.css / index.css** — Chat interface styles

### Request Flow

1. User types a message and presses "Send"
2. `handleSubmit` adds the user message to the conversation
3. `sendChatMessage()` sends the message to the backend
4. Response is validated with Zod
5. Assistant message is added to the conversation
6. If an error occurs, it's displayed to the user

### State Management

The app uses React's `useState` for:
- **messages** — Array of user and assistant messages
- **input** — Current text in the input field
- **isLoading** — Whether a request is in flight
- **error** — Current error message, if any

This is sufficient for Build 01's stateless request-response model. Part 3 introduces persistent conversation history.

## Project Structure

```
apps/web/
├── src/
│   ├── lib/
│   │   └── api.ts              # Backend client and validation
│   ├── App.tsx                 # Chat interface
│   ├── App.css                 # Chat styles
│   ├── index.css               # Global styles
│   └── main.tsx                # React entry point
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── .env.development            # Backend API URL
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Scope of This Build

**Included:**
- Chat interface with message submission
- Real-time input validation (character count)
- Loading and error states
- Response validation with Zod
- Backend boundary (API is the security and credential barrier)

**Not included yet:**
- Streaming responses (Part 2)
- Conversation persistence (Part 3)
- Rich message formatting or attachments
- User authentication
- Product knowledge or search
- Tool calling or actions
- Multi-step workflows

These are introduced incrementally.

## Security and Credential Management

**Never expose API keys to the frontend:**
- The backend owns the provider API key
- The frontend never calls the provider directly
- The backend validates all requests before forwarding them
- Error messages don't leak provider details or stack traces

This separation is critical for production. A compromised frontend API key is compromised permanently; a compromised backend can be redeployed with a new key.

## Error Handling

The frontend distinguishes between:

**Network errors** (user's connection or backend is down):
- "Connection failed. Check your network and try again."

**Validation errors** (user sent invalid input):
- "Enter a message of up to 4000 characters."

**Server errors** (provider or backend issue):
- "The assistant is temporarily unavailable. Please try again."

The backend handles all error logic; the frontend trusts the error `code` and `message` fields.

## Testing

Currently, there are no automated tests in the frontend. To test manually:

1. Start the backend on `http://localhost:3000`
2. Start the frontend on `http://localhost:5173`
3. Send a message
4. Verify the response appears
5. Try sending invalid input (empty, too long) and check validation
6. Stop the backend and verify the error state

## Environment Variables

See `.env.development` for frontend configuration:

- `VITE_API_BASE_URL` — Backend API URL (e.g., `http://localhost:3000`)

Development-only variables are not bundled in production builds.

## Production Deployment

Before deploying to production, ensure:

1. **Backend is production-ready** — See `apps/api/README.md`
2. **Environment variables are set correctly** — `.env.development` is for local dev only
3. **CORS is configured** — Backend must allow your production domain
4. **Error handling is appropriate** — Generic messages, no stack traces
5. **Logging is in place** — Monitor errors and user behavior

The build output is a static set of HTML, CSS, and JavaScript files. Serve them from a CDN or static host.

## Troubleshooting

**"Failed to fetch"**
- Is the backend running on `http://localhost:3000`?
- Check browser console for CORS errors
- Verify `VITE_API_BASE_URL` in `.env.development`

**"Unexpected response format"**
- Check the backend is returning the correct JSON shape
- Review the Zod schema in `src/lib/api.ts`
- Check browser DevTools Network tab for the actual response

**Vite not hot-reloading**
- Make sure you're editing files in `src/`
- Try refreshing the browser
- Restart `pnpm dev`

## Related Resources

- **Backend API:** `apps/api/README.md`
- **Build documentation:** `../README.md`
- **Series repository:** `typescript-agentic-ai/`
- **React documentation:** `https://react.dev`
- **Vite documentation:** `https://vitejs.dev`
