# OpenMemory

OpenMemory is open-source memory infrastructure for AI tools and MCP clients.
It gives each user a portable, graph-aware memory layer that can be shared
across assistants, agents, apps, and chat surfaces.

The project is intentionally Cloudflare-native: Workers for the API, Durable
Objects with SQLite for per-user graph state, D1 for auth/control-plane data,
Vectorize and Workers AI for semantic recall, R2 for exports, and Cloudflare's
MCP runtime for tool access.

> Status: alpha. The core memory API, graph store, OAuth-backed MCP endpoint,
> recall flow, source ingestion, async ingestion jobs, exports, repair path,
> dashboard, extraction workers, and local integration suite are working. The
> hosted profile/onboarding UI, named MCP request-profile dogfooding, larger
> recall benchmarks, typed relationship diagnostics, production telemetry, and
> release validation gates are working. Manual external OAuth callback
> dogfooding and higher-volume production operations remain active roadmap
> items.

## Why OpenMemory

AI memory should not be trapped inside one closed chat product. OpenMemory aims
to provide the infrastructure layer behind a more portable experience:

- Store facts, preferences, decisions, profile details, source chunks, and
  evolving context in a user-owned memory graph.
- Recall useful context through keyword, graph, and semantic retrieval.
- Let MCP-compatible tools read and write memory through OAuth-backed identity.
- Keep the operational footprint small by using Cloudflare services end to end.
- Make the implementation inspectable, testable, and self-hostable.

## What Works Today

- Multi-user memory isolation through Durable Object names.
- SQLite-backed memory graph per tenant with nodes, edges, entities, metadata,
  tags, confidence, importance, currentness, validity windows, and supersession.
- Canonical typed graph relationship taxonomy shared by the API, Durable
  Object graph store, Eden client, stats, tests, and web explorer.
- Memory create, read, update, soft-forget, search, profile, context, graph
  neighbors, graph stats, source ingestion, R2 export, and Vectorize repair APIs.
- Chunked source/document ingestion with source and chunk provenance.
- Async source ingestion jobs backed by Cloudflare Queues, Workflows, and the
  tenant Durable Object job ledger.
- Async entity and relationship extraction workers that enrich memory metadata
  and add relationship-specific graph edges.
- Deterministic recall reranking that combines retrieval score, reason,
  confidence, importance, recency, and currentness.
- Optional semantic candidate retrieval through Workers AI embeddings and
  Cloudflare Vectorize.
- Better Auth routes, OAuth 2.1/OIDC discovery, dynamic client registration,
  JWT/JWKS-backed resource tokens, and optional GitHub/Google login providers.
- Session-backed workspace and team member management backed by Drizzle/D1.
- Streamable HTTP MCP endpoint with `remember`, `recall`, `profile`, and
  `forget` tools.
- Authenticated OAuth/MCP connection listing and revocation.
- Worker-hosted dashboard for capture, recall, forgetting, and local inspection.
- TanStack Start web app with a polished hosted-dashboard direction, shared
  shadcn-style UI package, hosted profile editing, onboarding empty states,
  memory health metrics, charts, graph operations signals, and an
  Obsidian-style knowledge map backed by `react-force-graph-2d`.
- Wrangler-backed integration tests and optional Docker reproduction.

## Architecture

```txt
apps/web        TanStack Start app and richer product UI
apps/api        Cloudflare Worker API, dashboard, Better Auth, MCP endpoint
packages/client Eden Treaty client for typed API access
packages/core   Shared memory, graph, recall, and auth domain logic
packages/ui     shadcn-style shared UI primitives
```

Runtime services:

- **Cloudflare Workers + Elysia**: HTTP API, dashboard, auth routes, and MCP
  transport.
- **Durable Objects + SQLite**: isolated per-user memory graph databases.
- **Durable Objects**: global application rate limiting.
- **D1 + Drizzle**: Better Auth and control-plane schema.
- **Vectorize + Workers AI**: embedding generation and semantic retrieval.
- **R2**: tenant graph exports and backup artifacts.
- **Workers Analytics Engine**: request, error, rate-limit, and async worker
  telemetry.
- **Cloudflare Agents MCP**: streamable HTTP MCP surface.
- **Queues + Workflows**: async source ingestion plus memory entity/relationship
  extraction.

The default deployment shape is intentionally monolithic: API routes, Better
Auth, hosted dashboard, and `/mcp` ship as one Worker. MCP uses Cloudflare
Agents' `createMcpHandler`; split it into a dedicated `McpAgent` Worker only if
session-specific MCP state or separate operational scaling becomes necessary.

Cloudflare AI Search is tracked as an optional managed-search layer, not the
core graph/RAG substrate.

## Quick Start

Requirements:

- Bun `>=1.3.14`
- Node-compatible shell tooling
- Wrangler auth for Cloudflare resource provisioning or deploys
- Docker only if you want the clean container integration runner

Install and run local development:

```sh
bun install
bun run dev:api
bun run dev:web
```

Set up Cloudflare resources in a fresh account:

```sh
bun run setup:cloudflare
```

Database helpers:

```sh
bun run db:generate
bun run db:migrate:local
bun run db:migrate:remote
```

Current deployed API:

```txt
https://openmemory-api.abbierman101.workers.dev
```

Deployment details live in [docs/deployment.md](docs/deployment.md).

## API Surface

Useful endpoints:

- `GET /`
- `GET /health`
- `POST /v1/memories`
- `GET /v1/memories/:id`
- `PATCH /v1/memories/:id`
- `DELETE /v1/memories/:id`
- `POST /v1/search`
- `POST /v1/context`
- `POST /v1/ingest`
- `POST /v1/sources`
- `POST /v1/sources/async`
- `GET /v1/sources/:sourceId`
- `GET /v1/profile`
- `GET /v1/readiness`
- `GET /v1/graph/stats`
- `GET /v1/graph/relationships`
- `GET /v1/graph/:id/neighbors`
- `POST /v1/exports`
- `POST /v1/index/repair`
- `GET /v1/oauth/connections`
- `DELETE /v1/oauth/connections/:clientId`
- `POST /mcp`
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/openid-configuration`
- `/api/auth/*`

During local development, pass `x-openmemory-user-id: local-user`. If
`OPENMEMORY_API_TOKEN` is configured, also pass `Authorization: Bearer <token>`.
Production rejects tenant headers by design and uses OAuth-backed identity.
Every response includes `x-openmemory-request-id` and rate-limit headers for
supportability. Configure the per-isolate safety valve with
`OPENMEMORY_RATE_LIMIT_PER_MINUTE` or disable it with
`OPENMEMORY_RATE_LIMIT_ENABLED=false` for controlled environments.

## MCP

OpenMemory exposes a streamable HTTP MCP endpoint at:

```txt
https://openmemory-api.abbierman101.workers.dev/mcp
```

Requests should include:

```txt
Accept: application/json, text/event-stream
Content-Type: application/json
```

See [docs/mcp.md](docs/mcp.md) and
[docs/mcp-compatibility.md](docs/mcp-compatibility.md) for OAuth discovery,
generic client configuration, tested client request shapes, local development,
tools, and connection revocation.

## Auth

The Worker serves Better Auth at `/api/auth/*` and exposes OAuth/OIDC discovery
from root well-known URLs. Production MCP and API access use OAuth bearer tokens;
verified token subjects become memory tenants.

Optional provider secrets enable social login:

```sh
bun --cwd apps/api wrangler secret put GITHUB_CLIENT_ID
bun --cwd apps/api wrangler secret put GITHUB_CLIENT_SECRET
bun --cwd apps/api wrangler secret put GOOGLE_CLIENT_ID
bun --cwd apps/api wrangler secret put GOOGLE_CLIENT_SECRET
```

Auth storage uses `AUTH_DB` D1 through Drizzle when configured and falls back to
an in-memory adapter for local tests and development.

Note: `kysely@0.28.17` remains installed only as a Better Auth bundling
compatibility dependency. OpenMemory's ORM path is Drizzle.

## Testing

OpenMemory follows the testing trophy: targeted unit coverage, heavier
integration coverage around runtime boundaries, MemoryBench-style recall and
graph-scale benchmarks, named MCP client request-profile smoke, and end-to-end
browser/API smoke for the deployed product.

```sh
bun run release:validate
```

For the faster pull-request loop:

```sh
bun run check
bun run build
bun run test:integration:local
bun run test:mcp:sdk
bun run test:e2e:local
bun run test:benchmark:local
```

The local integration suite starts real Wrangler Workers on randomized
non-default ports, applies D1 migrations into isolated local persistence, and
exercises Durable Objects, D1 auth storage, Better Auth sessions, OAuth
metadata, MCP, graph edges, recall, sync and async source ingestion, extraction
workers, Queues, Workflows, exports, index repair, and the dashboard API.

The MCP SDK smoke starts local Wrangler and drives `/mcp` through the official
TypeScript SDK `StreamableHTTPClientTransport`.

The local browser E2E suite starts the API and TanStack Start app on explicit
non-default ports and exercises the dashboard, charts, memory table, source
ingest, graph explorer, admin settings, and MCP setup panel.

Optional clean container reproduction:

```sh
bun run test:integration:docker
```

Optional heavier local scale check:

```sh
bun run test:scale:local
```

Optional live checks:

```sh
bun run --cwd apps/api test:live
bun run test:e2e:ui
```

The live checks require a reachable deployment and any environment required by
the target workflow.

## Roadmap

Current priorities:

- Polish hosted onboarding and profile-editing flows.
- Keep the hosted TanStack Start app as a companion dashboard/control plane
  while API and MCP integrations remain the primary product surfaces.
- Expand charts and the knowledge map for graph health, recall quality, index
  freshness, and MCP usage.
- Expand recall quality benchmarks with larger MemoryBench-style fixtures.
- Add larger graph performance benchmarks and production telemetry.
- Deepen MCP client compatibility testing with real external clients.
- Keep Cloudflare Git/Workers Builds as the preferred production deploy path.

See [docs/roadmap.md](docs/roadmap.md) for the current working baseline and
remaining implementation tracks.

## Docs

- [Deployment](docs/deployment.md)
- [Operations runbook](docs/operations.md)
- [Observability](docs/observability.md)
- [Data model](docs/data-model.md)
- [Launch announcement](docs/launch-announcement.md)
- [MCP setup](docs/mcp.md)
- [MCP compatibility](docs/mcp-compatibility.md)
- [Roadmap](docs/roadmap.md)
- [Launch readiness](docs/launch-readiness.md)
- [Release qualification](docs/release-qualification.md)
- [Testing strategy](docs/plans/testing-strategy.md)
- [Cloudflare memory stack research](docs/research/cloudflare-memory-stack.md)
- [Cloudflare RAG bottlenecks](docs/research/cloudflare-rag-bottlenecks.md)
- [Graph memory architecture](docs/research/graph-memory-architecture.md)
- [Supermemory feature evaluation](docs/research/supermemory-feature-evaluation.md)
- [Requirements brainstorm](docs/brainstorms/openmemory-requirements.md)
- [Implementation plan](docs/plans/openmemory-plan.md)

## Contributing

OpenMemory is MIT licensed. See [CONTRIBUTING.md](CONTRIBUTING.md),
[SECURITY.md](SECURITY.md), [SUPPORT.md](SUPPORT.md), and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening issues or PRs.
