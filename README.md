# Applied AI Lab

## From Prompt to Platform

A technical Medium series and accompanying GitHub repository documenting the evolution of a production-oriented agentic AI system, built incrementally in TypeScript.

The series follows one fictional e-commerce application, **Storefront AI**, as it evolves from a basic LLM-powered chat interface into a reliable, observable, tool-enabled AI system with retrieval, workflows, and multi-agent capabilities.

The goal is not to demonstrate AI libraries. It is to explain how an engineer designs, builds, tests, and evolves an AI application under real-world constraints.

## Why This Series

- Building a real AI application is harder than calling an API once.
- Good architecture matters: credentials, validation, errors, observability, costs.
- Frameworks and tools should be introduced only when a concrete requirement justifies them.
- Production engineering applies to AI systems—the model helps with reasoning, but the application owns everything else.

This series bridges the gap between "hello world" LLM examples and production-ready systems.

## The Series Roadmap

| Part | Topic                                                              | Directory                                               |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| 1    | Basic LLM chat and a server-side AI API                            | `typescript-agentic-ai/build-01-basic-chat/`            |
| 2    | End-to-end streaming with React, Fastify, and TypeScript           | `typescript-agentic-ai/build-02-streaming/`             |
| 3    | Conversation history and persistent state                          | `typescript-agentic-ai/build-03-conversation-state/`    |
| 4    | Structured outputs and reliable model contracts                    | `typescript-agentic-ai/build-04-structured-outputs/`    |
| 5    | Product knowledge, embeddings, vector search, and RAG              | `typescript-agentic-ai/build-05-product-rag/`           |
| 6    | Tool calling and controlled access to business capabilities        | `typescript-agentic-ai/build-06-tool-calling/`          |
| 7    | The agent loop, execution control, and stopping conditions         | `typescript-agentic-ai/build-07-agent-loop/`            |
| 8    | Introducing LangChain.js when abstraction becomes valuable         | `typescript-agentic-ai/build-08-langchain/`             |
| 9    | LangGraph.js for stateful workflows and orchestration              | `typescript-agentic-ai/build-09-langgraph-workflows/`   |
| 10   | Building and integrating MCP servers                               | `typescript-agentic-ai/build-10-mcp/`                   |
| 11   | Specialist agents, multi-agent workflows, and human approval       | `typescript-agentic-ai/build-11-multi-agent-workflows/` |
| 12   | Observability, tracing, evaluation, and cost management            | `typescript-agentic-ai/build-12-observability-evals/`   |
| 13   | Production hardening, reliability, background jobs, and deployment | `typescript-agentic-ai/build-13-production-hardening/`  |

Each build is a meaningful, reproducible checkpoint. A reader can find the code corresponding to an article and run it by following the setup instructions in that build's README.

## Getting Started

### Part 1: Basic LLM Chat

The first build establishes the foundational request path: React → Fastify → OpenAI → Response.

```bash
cd typescript-agentic-ai/build-01-basic-chat
pnpm install

# Configure backend
cat > apps/api/.env << EOF
OPENAI_API_KEY=your_key_here
MODEL=gpt-4o-mini
WEB_ORIGIN=http://localhost:5173
EOF

# Start backend (one terminal)
pnpm -F api dev

# Start frontend (another terminal)
pnpm -F web dev

# Open http://localhost:5173
```

See `typescript-agentic-ai/build-01-basic-chat/README.md` for full instructions.

### Reading the Articles

Each part of the series is published on Medium:

1. [Designing a Production Agentic AI System in TypeScript](https://medium.com/@ramasamymohan/designing-a-production-agentic-ai-system-typescript-5f1e4f7a12df)
2. (Coming soon)

Articles explain the production problem, architecture decisions, implementation details, and what breaks next.

## Repository Structure

```
applied-ai-lab/
├── typescript-agentic-ai/
│   ├── build-01-basic-chat/    # Part 1: Basic chat
│   │   ├── apps/
│   │   │   ├── api/            # Fastify backend
│   │   │   └── web/            # React frontend
│   │   ├── .env.example
│   │   └── README.md           # Build-specific docs
│   ├── build-02-streaming/     # Part 2: Streaming
│   ├── build-03-conversation-state/
│   └── ...
├── README.md                   # This file
└── (This project documentation)
```

Each build is self-contained and can be run independently, though reading them in order is recommended.

## Stack

- **Frontend:** React + TypeScript + Vite
- **Backend:** Node.js + Fastify + TypeScript
- **Validation:** Zod
- **Provider integration:** OpenAI SDK initially
- **Data and retrieval:** PostgreSQL + pgvector (introduced when needed)
- **Caching:** Redis (introduced when justified)
- **Workflows:** LangChain.js and LangGraph.js (introduced at appropriate stages)
- **Testing:** Vitest
- **Package manager:** pnpm

Technologies are introduced incrementally as requirements emerge, not upfront.

## Core Principles

### Build One Evolving Application

Storefront AI is the common thread throughout. The series doesn't jump between independent demos or agents. Each part extends the previous one conceptually and architecturally.

### Introduce Complexity Only When Justified

The first build uses the OpenAI SDK directly, not LangChain or an orchestration framework. When basic request-response becomes insufficient, streaming is added. When streaming isn't enough, conversation state. And so on.

This approach makes it clear why each technology exists and what problem it solves.

### The Application Controls the Environment

The central architectural principle: **The application controls the environment. The model helps decide what to do inside that environment.**

The application remains responsible for:

- Security and credential management
- Input validation and sanitization
- Authorization and access control
- Tool execution and external integration
- State management and persistence
- Error handling and recovery
- Observability and cost management

The model's output is never treated as trusted or automatically executable.

### Prioritize Production Engineering

Production AI engineering is still production engineering. AI doesn't eliminate traditional concerns—it adds new failure modes.

Each build discusses:

- API security and secret management
- Input validation and output contracts
- Timeouts, retries, and failure recovery
- Rate limiting and resource consumption
- Latency, token usage, and cost
- Logging, tracing, and observability
- Testing and regression prevention

These concerns are introduced at the stage where they become relevant, not all at once.

## How to Use This Repository

### For Learning

1. Start with **Part 1** in `typescript-agentic-ai/build-01-basic-chat/`
2. Read the accompanying [Medium article](https://medium.com/@ramasamymohan/designing-a-production-agentic-ai-system-typescript-5f1e4f7a12df)
3. Run the code to see it working
4. Review the code and architecture
5. Move to Part 2 when ready

### For Reference

- Look up a specific build directory for its implementation
- Each build's README documents the setup, architecture, and scope
- Search within a build for a specific pattern or feature

### For Your Own Project

- Use a build as a starting template for your own agentic AI system
- Follow the same principle: start simple, add complexity only when justified
- Check the "What breaks next?" section to preview the next constraint

## Development

Each build is a separate pnpm workspace. To work on a specific build:

```bash
cd typescript-agentic-ai/build-01-basic-chat
pnpm install
pnpm dev              # Starts both frontend and backend (in watch mode with hot reload)
pnpm test             # Runs tests
```

Or start frontend and backend in separate terminals:

```bash
# Terminal 1: Backend
pnpm -F api dev

# Terminal 2: Frontend
pnpm -F web dev
```

## Contributing and Feedback

This is a learning-focused series. If you have:

- Questions about a specific build or architectural choice
- Suggestions for clarity or additional context
- Production concerns that should be highlighted
- Issues running the code

Please open an issue or discussion in the repository.

## Production Readiness

**Each build is a teaching checkpoint, not a production release.**

The "Production Lens" section in each article highlights operational concerns relevant to that stage. But earlier builds are intentionally simplified for clarity. Production deployment would require:

- Comprehensive error handling and recovery
- Distributed tracing and structured logging
- Metrics, alerting, and dashboards
- Authentication and authorization
- Rate limiting and quota management
- Cost monitoring and controls
- Testing, evaluation, and continuous improvement
- Deployment automation and rollback procedures

The final builds (Parts 12–13) focus on these hardening steps.

## See Also

- [OpenAI API Documentation](https://platform.openai.com/docs)
- [Fastify Documentation](https://www.fastify.io/)
- [React Documentation](https://react.dev)
- [LangChain.js](https://js.langchain.com/)
- [LangGraph.js](https://js.langchain.com/docs/langgraph)

---

**Authored by:** Ramya Samymohan  
**Series:** From Prompt to Platform  
**Updated:** October 2026
