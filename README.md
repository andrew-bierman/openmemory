# OpenMemory

Open-source memory infrastructure for AI tools, built entirely on Cloudflare.

The current alpha is a multi-user memory API that stores each user's evolving memory graph in a SQLite-backed Durable Object, enriches recall with Vectorize and Workers AI when bindings are configured, exposes HTTP and Cloudflare-native MCP surfaces, and serves a small Worker-hosted dashboard.

## Stack

- Bun workspaces + Turborepo for the monorepo.
- Cloudflare Workers + Elysia for the API, with Eden Treaty planned for typed clients.
- `@openmemory/client` wraps Eden Treaty for typed API calls.
- Durable Objects with SQLite for isolated per-user graph databases.
- Drizzle ORM + Drizzle Kit for D1 auth/control-plane schema and migrations.
- Vectorize + Workers AI for semantic recall.
- Better Auth OAuth Provider for OAuth 2.1/OIDC discovery, dynamic client registration, and JWT/JWKS-backed resource tokens.
- Cloudflare Agents `createMcpHandler` for streamable HTTP MCP.
- Vitest for package and Wrangler-backed integration tests.
- Cloudflare AI Search is tracked as an optional managed-search layer, not the core graph/RAG substrate.
- R2 for future graph exports and backups.
- Queues and Workflows for future ingestion/extraction pipelines.
- TanStack Start web app in `apps/web`.
- shadcn-style package layout with shared TypeScript config and `@openmemory/ui`.

## Alpha Capabilities

- Per-tenant memory graph isolation through Durable Object names.
- Memory lifecycle fields: type, status, currentness, confidence, importance, validity window, supersession, tags, entities, and metadata.
- Versioned updates through `PATCH /v1/memories/:id`; `updates` supersedes the old memory and creates a graph edge.
- Soft forgetting through `DELETE /v1/memories/:id`.
- Keyword recall with optional semantic candidate IDs from Vectorize when Workers AI and Vectorize are available.
- Profile and context assembly through `/v1/profile` and `/v1/context`.
- Native streamable HTTP MCP endpoint at `/mcp` with `remember`, `recall`, `forget`, and `profile` tools.
- Minimal dashboard at `/` for local inspection and capture.
- Better Auth routes at `/api/auth/*`, plus root OAuth/OIDC discovery at `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`.
- Tenant headers are supported only for localhost development.
- Deployed MCP requests use Better Auth OAuth bearer tokens; verified token subjects become the memory tenant.
- Optional bearer-token auth through `OPENMEMORY_API_TOKEN` can be layered onto trusted service-to-service environments.

## Quick Start

```sh
bun install
bun run dev:api
bun run dev:web
```

Cloudflare setup:

```sh
bun run setup:cloudflare
```

See `docs/deployment.md` for required Wrangler auth, resources, secrets, and the GitHub Actions deploy workflow.

Current deployed API:

```txt
https://openmemory-api.abbierman101.workers.dev
```

Database helpers:

```sh
bun run db:generate
bun run db:migrate:local
bun run db:migrate:remote
```

Useful endpoints:

- `GET /`
- `GET /health`
- `POST /v1/memories`
- `GET /v1/memories/:id`
- `PATCH /v1/memories/:id`
- `DELETE /v1/memories/:id`
- `POST /v1/search`
- `POST /v1/context`
- `GET /v1/profile`
- `GET /v1/graph/:id/neighbors`
- `POST /mcp`
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/openid-configuration`
- `/api/auth/*`

During local development, pass `x-openmemory-user-id: local-user`. If `OPENMEMORY_API_TOKEN` is configured, also pass `Authorization: Bearer <token>`.

MCP requests should include:

```txt
Accept: application/json, text/event-stream
Content-Type: application/json
```

## Verification

```sh
bun run check
bun run build
```

Local integration tests:

```sh
bun run test:integration:local
```

The integration tests start real local Wrangler Workers on randomized non-default ports, apply D1 migrations into isolated local persistence, and exercise Durable Objects, D1 auth storage, Better Auth sessions, OAuth metadata, MCP, graph edges, recall, and the dashboard. This keeps the high-value testing trophy layer local and credential-free while avoiding collisions with other agents or projects on the same machine.

Optional clean container reproduction:

```sh
bun run test:integration:docker
```

The Docker path uses the pinned Bun image and runs the same local Wrangler integration suite in a clean Linux container. Docker is not required for normal CI because Wrangler/Miniflare already provides the local Cloudflare runtime.

## Auth Status

The alpha now wires Better Auth's OAuth Provider into the Worker:

- `/api/auth/*` is served by Better Auth.
- OAuth authorization-server metadata and OpenID discovery are exposed at the root well-known URLs.
- The provider includes the required Better Auth JWT plugin, so resource-scoped access tokens can be verified through JWKS.
- Dynamic client registration is enabled for MCP-compatible clients.
- GitHub and Google login providers are enabled automatically when their client id/secret env vars are present.
- Auth storage uses `AUTH_DB` D1 through Drizzle when that binding is configured, and falls back to an in-memory adapter for local tests and dev.
- `/mcp` keeps the tenant-header flow on localhost only; deployed MCP requests require Better Auth OAuth bearer tokens.
- HTTP API routes trust `x-openmemory-user-id` only on localhost. Deployed routes must use OAuth-backed identity.

The personal Cloudflare deployment has D1 `AUTH_DB`, Vectorize, R2, Workers AI, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` configured. Local tests intentionally avoid requiring those external Cloudflare resources.

Note: `kysely@0.28.17` remains installed only as a Better Auth bundling compatibility dependency. OpenMemory's ORM path is Drizzle.

## Research And Planning

- `docs/research/cloudflare-memory-stack.md`
- `docs/research/cloudflare-rag-bottlenecks.md`
- `docs/research/supermemory-feature-evaluation.md`
- `docs/plans/testing-strategy.md`
- `docs/brainstorms/openmemory-requirements.md`
- `docs/plans/openmemory-plan.md`
- `docs/roadmap.md`
- `docs/deployment.md`
