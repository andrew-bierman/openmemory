# OpenMemory Roadmap

## Current Working Baseline

- Private GitHub repo is live at `andrew-bierman/openmemory`.
- Open-source launch scaffolding exists: MIT license, contribution guide,
  security policy, support policy, code of conduct, changelog, issue templates,
  PR template, and launch-readiness checklist.
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
- CI runs local type/build checks, Wrangler-backed integration tests, and local browser E2E against the TanStack dashboard.
- Cloudflare production resources are provisioned in the personal account:
  - D1 `openmemory-auth` bound as `AUTH_DB`
  - Vectorize `openmemory-vectors` bound as `MEMORY_VECTORS`
  - R2 `openmemory-exports` bound as `MEMORY_EXPORTS`
  - Queue `openmemory-source-ingestion` and dead-letter queue
    `openmemory-source-ingestion-dlq`
  - Workflow `openmemory-source-ingestion` bound as
    `SOURCE_INGESTION_WORKFLOW`
  - Queue `openmemory-memory-extraction` and dead-letter queue
    `openmemory-memory-extraction-dlq`
  - Workflow `openmemory-memory-extraction` bound as
    `MEMORY_EXTRACTION_WORKFLOW`
  - Workers Analytics Engine `openmemory_events` bound as
    `OPENMEMORY_ANALYTICS`
  - Worker secrets for `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`
- The API Worker is deployed at `https://openmemory-api.abbierman101.workers.dev`.
- Worker-hosted login, signup, consent, and dashboard flows use Better Auth session cookies.
- `apps/web` now has a polished hosted-dashboard direction with memory health metrics, capture cadence charts, memory-type distribution, admin settings, MCP setup, and a library-backed Obsidian-style knowledge map over graph-shaped memory data.
- Opt-in production API E2E covers hosted UI response, Better Auth session, graph recall, OAuth PKCE, MCP `remember`, `recall`, `profile`, and `forget`.
- Opt-in browser E2E covers deployed login/signup, dashboard remember, refresh, recall, and forget.
- `/v1/sources` chunks longer source/document content, preserves source/chunk provenance metadata, indexes each chunk, and creates graph edges between adjacent chunks.
- `/v1/sources/async` creates durable ingestion jobs, buffers requests through
  Cloudflare Queues, and runs the same graph/indexing pipeline through a
  Cloudflare Workflow.
- Memory create/update/source chunk ingestion enqueues extraction work that
  enriches entity metadata and adds relationship-specific graph edges.
- `/v1/graph/stats` exposes graph size counters, and local Wrangler integration includes a moderate graph-scale recall smoke.
- Recall candidates pass through a deterministic reranker that combines retrieval score, retrieval reason, importance, confidence, recency, and currentness.
- Authenticated users can list and revoke OAuth/MCP client connections through `/v1/oauth/connections`, and the TanStack MCP panel surfaces those connections.
- `docs/mcp.md` documents MCP discovery, tool surface, generic streamable HTTP config, local development, and connection revocation.
- `bun run test:mcp:sdk` dogfoods the MCP endpoint through the official
  TypeScript SDK `StreamableHTTPClientTransport`.
- Workers Analytics Engine captures `openmemory.request`,
  `openmemory.request_error`, rate-limit, 5xx, and async worker failure events,
  with saved SQL in `docs/observability-queries.sql`.
- The `Live Smoke` workflow runs hourly against production as the alpha alert
  path for API, auth, MCP, and hosted UI regressions.
- `/v1/exports` serializes a tenant graph and writes JSON backups to R2 when `MEMORY_EXPORTS` is configured.
- `/v1/index/repair` re-upserts active tenant memories through the embedding and Vectorize indexing path.
- Local recall benchmark coverage includes multiple golden cases across people, decisions, preferences, source chunks, graph expansion, and distractors.
- `scripts/setup-cloudflare.sh` documents and automates resource creation for a fresh account.

## Not Fully Solved Yet

- Browser auth and dashboard need deeper product polish:
  - deployed API routes reject header tenant mode by design
  - local development still supports tenant headers for tests and fast iteration
  - the TanStack app still needs richer authenticated navigation, hosted deployment wiring, and more refined user/account flows
- RAG quality is still basic:
  - no LLM/ML reranker
- recall benchmark coverage has useful golden cases, but still needs larger MemoryBench-style fixtures before public release confidence
- Graph performance has a first moderate local smoke and production request
  telemetry, but still needs larger volume benchmarks and graph-specific
  performance dashboards.
- GitHub Actions are configured. Cloudflare Git/Workers Builds should be the preferred deploy path; the manual GitHub deploy workflow remains a fallback and needs a scoped `CLOUDFLARE_API_TOKEN` repository secret.
- Optional GitHub and Google login providers still need OAuth app client IDs and secrets.
- Repository still needs final public-launch operations: enable Discussions,
  confirm GitHub topics/about metadata, create the first tagged alpha release,
  and switch visibility from private to public when ready.

## Next Implementation Tracks

1. Auth hardening
   - Expand authenticated navigation and account settings.
   - Keep `x-openmemory-user-id` only for local development and tests.

2. MCP production flow
   - Manually test interactive OAuth clients such as MCP Inspector, Cursor,
     Claude, and ChatGPT connector flows before broad launch.
   - Expand OAuth lifecycle UI from connection revocation into full client
     registration/management if we need first-party clients.

3. RAG pipeline
   - Extend the Queue/Workflow pipeline from source chunks to conversation
     transcript extraction and enrichment.
   - Improve extraction quality with Workers AI once deterministic extraction
     has enough production traces to evaluate.
   - Store embeddings in Vectorize for every chunk and add deeper stale-index diagnostics.
   - Tune deterministic reranking and evaluate an optional LLM/ML reranker.
   - Expand recall quality benchmarks with MemoryBench-style fixtures.
   - Add larger graph performance benchmarks and production telemetry.

4. Web app expansion
   - Expand authenticated navigation, profile editing, account administration, and tenant/team management.
   - Keep the hosted TanStack Start UI as a companion dashboard/control plane; the API and MCP integrations remain the primary product surfaces.
   - Use shadcn dashboard templates, defaults, and theme tokens as the baseline; defer Apple/SwiftUI-specific styling until the product structure is stronger.
   - Expand charts for recall quality, memory growth, stale/superseded memories, indexing health, and MCP usage.
   - Continue hardening the `react-force-graph` explorer and evaluate Sigma.js + Graphology, Reagraph, or React Flow only if graph size and layout requirements outgrow the current approach.
   - Expand browser tests for authenticated account flows, MCP connection revocation with seeded grants, and tenant/team administration.

5. CI and deployment
   - Connect Cloudflare Git/Workers Builds to `main`.
   - Keep GitHub CI as quality gate.
   - Keep hourly live-smoke passing against production after deploys.
   - Add Cloudflare Notifications or external paging before any higher-volume
     hosted launch.
   - Add a scoped `CLOUDFLARE_API_TOKEN` repository secret only if we keep the GitHub manual deploy fallback.

6. Open-source launch operations
   - Enable GitHub Discussions for support and architecture questions.
   - Set repository topics for `cloudflare`, `mcp`, `ai-memory`, `rag`,
     `durable-objects`, `vectorize`, `workers-ai`, and `typescript`.
   - Create the first tagged alpha release with current validation evidence.
   - Switch the repository from private to public after launch checklist review.
