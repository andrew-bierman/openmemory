# OpenMemory Roadmap

## Current Working Baseline

- Private GitHub repo is live at `andrew-bierman/openmemory`.
- `apps/api` runs as a Cloudflare Worker with Elysia.
- Per-tenant memory graph storage works in SQLite-backed Durable Objects.
- Better Auth OAuth Provider exposes auth routes and OAuth/OIDC discovery.
- Drizzle defines the D1 auth/control-plane schema and generates migrations.
- `apps/web` is a TanStack Start app that can create, list, forget, and recall memories against the API.
- `packages/client` exposes the Eden Treaty client foundation.
- `packages/ui` contains shadcn-style shared UI primitives.
- `bun run check` passes across Biome, Turbo, TypeScript, Vitest, and Wrangler-backed API integration tests.
- `bun run --cwd apps/web build` produces a production TanStack Start build.
- CI, manual deploy, and manual live-smoke workflows are defined in `.github/workflows`.
- Cloudflare production resources are provisioned in the personal account:
  - D1 `openmemory-auth` bound as `AUTH_DB`
  - Vectorize `openmemory-vectors` bound as `MEMORY_VECTORS`
  - R2 `openmemory-exports` bound as `MEMORY_EXPORTS`
  - Worker secrets for `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`
- The API Worker is deployed at `https://openmemory-api.abbierman101.workers.dev`.
- Worker-hosted login, signup, consent, and dashboard flows use Better Auth session cookies.
- Opt-in production API E2E covers hosted UI response, Better Auth session, graph recall, OAuth PKCE, MCP `remember`, `recall`, `profile`, and `forget`.
- Opt-in browser E2E covers deployed login/signup, dashboard remember, refresh, recall, and forget.
- `/v1/sources` chunks longer source/document content, preserves source/chunk provenance metadata, indexes each chunk, and creates graph edges between adjacent chunks.
- `/v1/graph/stats` exposes graph size counters, and local Wrangler integration includes a moderate graph-scale recall smoke.
- Recall candidates pass through a deterministic reranker that combines retrieval score, retrieval reason, importance, confidence, recency, and currentness.
- Authenticated users can list and revoke OAuth/MCP client connections through `/v1/oauth/connections`, and the TanStack MCP panel surfaces those connections.
- `docs/mcp.md` documents MCP discovery, tool surface, generic streamable HTTP config, local development, and connection revocation.
- `/v1/exports` serializes a tenant graph and writes JSON backups to R2 when `MEMORY_EXPORTS` is configured.
- `scripts/setup-cloudflare.sh` documents and automates resource creation for a fresh account.

## Not Fully Solved Yet

- Browser auth and dashboard need deeper product polish:
  - deployed API routes reject header tenant mode by design
  - local development still supports tenant headers for tests and fast iteration
  - the Worker-hosted dashboard is functional but minimal
  - the TanStack app still needs richer authenticated navigation and deployment wiring
- RAG quality is still basic:
  - source/document ingestion is synchronous rather than Queue/Workflow-backed
  - no entity extraction worker
  - no relationship extraction worker
  - no LLM/ML reranker
- recall benchmark coverage exists, but not enough golden cases for shipping confidence at realistic scale
- Graph performance has a first moderate local smoke, but still needs larger volume benchmarks and production telemetry.
- GitHub Actions are configured. Cloudflare Git/Workers Builds should be the preferred deploy path; the manual GitHub deploy workflow remains a fallback and needs a scoped `CLOUDFLARE_API_TOKEN` repository secret.
- Optional GitHub and Google login providers still need OAuth app client IDs and secrets.

## Next Implementation Tracks

1. Auth hardening
   - Expand authenticated navigation and account settings.
   - Keep `x-openmemory-user-id` only for local development and tests.

2. MCP production flow
   - Add external MCP client smoke with a real client once chosen.
   - Expand OAuth lifecycle UI from connection revocation into full client registration/management if we need first-party clients.

3. RAG pipeline
   - Move source/document ingestion onto Queues and Workflows.
   - Extract richer entities and relationships into the graph.
   - Store embeddings in Vectorize for every chunk and repair stale indexes.
   - Tune deterministic reranking and evaluate an optional LLM/ML reranker.
   - Expand recall quality benchmarks with MemoryBench-style fixtures.
   - Add larger graph performance benchmarks and production telemetry.

4. Web app expansion
   - Add authenticated navigation, memory detail, graph neighbors, profile editor, source ingestion, and MCP connection views.
   - Expand browser tests for graph inspection, MCP connection revocation, and account settings.

5. CI and deployment
   - Connect Cloudflare Git/Workers Builds to `main`.
   - Keep GitHub CI as quality gate.
   - Use the manual live-smoke workflow after deploys.
   - Add a scoped `CLOUDFLARE_API_TOKEN` repository secret only if we keep the GitHub manual deploy fallback.
