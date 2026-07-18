# OpenMemory Roadmap

## Current Working Baseline

- Public GitHub repo is live at `andrew-bierman/openmemory`.
- Open-source launch scaffolding exists: MIT license, contribution guide,
  security policy, support policy, code of conduct, changelog, issue templates,
  PR template, and launch-readiness checklist.
- `apps/api` runs as a Cloudflare Worker with Elysia.
- Per-tenant memory graph storage works in SQLite-backed Durable Objects.
- Better Auth OAuth Provider exposes auth routes and OAuth/OIDC discovery.
- Drizzle defines the D1 auth/control-plane schema and generates migrations.
- `apps/web` is a TanStack Start app that can create, list, forget, and recall memories against the API.
- Production `/` serves the generated TanStack dashboard shell through
  Cloudflare Worker Assets while API, auth, MCP, health, login, consent, and
  discovery routes remain Worker-first.
- `packages/client` exposes the Eden Treaty client foundation.
- `packages/ui` contains shadcn-style shared UI primitives.
- `bun run check` passes across Biome, Turbo, TypeScript, Vitest, and Wrangler-backed API integration tests.
- `bun run --cwd apps/web build` produces a production TanStack Start build.
- CI, manual deploy, manual live-smoke, and manual release-qualification
  workflows are defined in `.github/workflows`.
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
- `apps/web` now has a polished hosted-dashboard direction with memory health metrics, capture cadence charts, memory-type distribution, hosted profile editing, onboarding empty states, admin settings, MCP setup, graph operations signals, and a library-backed Obsidian-style knowledge map over graph-shaped memory data.
- Opt-in production API E2E covers hosted UI response, Better Auth session,
  tenant readiness snapshots, graph recall, source ingestion, R2 export, OAuth
  PKCE, MCP `remember`, `recall`, `profile`, and `forget`.
- Opt-in browser E2E covers deployed login/signup, dashboard remember, refresh,
  recall, forget, and browser-session readiness access.
- `/v1/sources` chunks longer source/document content, preserves source/chunk provenance metadata, indexes each chunk, and creates graph edges between adjacent chunks.
- `/v1/sources/async` creates durable ingestion jobs, buffers requests through
  Cloudflare Queues, and runs the same graph/indexing pipeline through a
  Cloudflare Workflow.
- Memory create/update/source chunk ingestion enqueues extraction work that
  enriches entity metadata and adds relationship-specific graph edges.
- `packages/core` owns the canonical graph relationship taxonomy used by edge
  validation, the Durable Object graph store, the Eden client, integration
  tests, and the TanStack graph explorer.
- `/v1/graph/stats` exposes graph size counters, relationship distribution, and
  graph density; `/v1/graph/relationships` exposes the relationship catalog to
  clients.
- `/v1/readiness` exposes a tenant-scoped operational snapshot for graph,
  relationship, auth, MCP, binding, export, and rate-limit readiness without
  leaking secrets or memory contents.
- `docs/data-model.md` records the current D1, Durable Object, Vectorize, R2,
  Queue/Workflow, OAuth, MCP, and readiness data shape.
- Local Wrangler integration includes a moderate graph-scale recall smoke, and
  `bun run test:scale:local` runs a heavier bounded graph check with an
  overridable 220 to 1,000 memory size.
- Recall candidates pass through a deterministic reranker that combines retrieval score, retrieval reason, importance, confidence, recency, and currentness.
- Authenticated users can list and revoke OAuth/MCP client connections through `/v1/oauth/connections`, and the TanStack MCP panel surfaces those connections.
- `docs/mcp.md` documents MCP discovery, tool surface, generic streamable HTTP config, local development, and connection revocation.
- `bun run test:mcp:sdk` dogfoods the MCP endpoint through the official
  TypeScript SDK `StreamableHTTPClientTransport` across named request profiles
  for the official SDK, MCP Inspector, Cursor, Claude-style clients, and
  ChatGPT-style connector clients.
- Workers Analytics Engine captures `openmemory.request`,
  `openmemory.request_error`, rate-limit, 5xx, and async worker failure events,
  with saved SQL in `docs/observability-queries.sql`.
- The `Live Smoke` workflow runs hourly against production as the alpha alert
  path for API, auth, readiness, MCP, and hosted UI regressions.
- `/v1/exports` serializes a tenant graph and writes JSON backups to R2 when `MEMORY_EXPORTS` is configured.
- `/v1/index/repair` re-upserts active tenant memories through the embedding and Vectorize indexing path.
- `DELETE /v1/tenant` hard-deletes the resolved tenant's Durable Object graph
  data after explicit tenant confirmation and best-effort deletes matching
  Vectorize ids.
- `/v1/account` exposes session-backed account, workspace, and team member
  management backed by Drizzle/D1.
- The TanStack admin panel can sign in, rename a hosted workspace, invite or
  remove workspace members, manage runtime settings, and revoke MCP OAuth
  grants.
- Local recall benchmark coverage includes larger MemoryBench-style golden cases across people, decisions, preferences, source chunks, graph expansion, operations, MCP, UI, and distractors.
- Local graph performance coverage exercises a 220-memory tenant graph, and the
  dashboard exposes graph operations status from active node and edge density
  signals.
- `scripts/setup-cloudflare.sh` documents and automates resource creation for a fresh account.

## Not Fully Solved Yet

- Browser auth and dashboard need production feedback:
  - deployed API routes reject header tenant mode by design
  - local development still supports tenant headers for tests and fast iteration
  - the TanStack app now has real account, profile editing, onboarding, team
    management, shadcn-style dashboard surfaces, charts, and a wide graph
    explorer, but still needs broader hosted user feedback on navigation
- RAG quality is still basic:
  - no LLM/ML reranker
- recall benchmark coverage has larger golden fixtures, but still needs an
  external MemoryBench import path if we adopt a third-party benchmark corpus
- Graph performance has larger local smoke coverage, graph-specific product
  signals, relationship diagnostics, and production request telemetry, but
  still needs high-volume production benchmarks before a hosted SaaS launch.
- GitHub Actions are configured. Cloudflare Git/Workers Builds should be the
  preferred deploy path; the manual GitHub deploy workflow remains a fallback
  and needs a scoped `CLOUDFLARE_API_TOKEN` repository secret.
- Optional GitHub and Google login providers still need OAuth app client IDs and secrets.
- Repository public-launch operations are complete: Discussions, topics/about
  metadata, public visibility, and the first tagged alpha release are live.
- Launch copy and first-feedback triage guidance live in
  `docs/launch-announcement.md`.

## Next Implementation Tracks

1. Auth hardening
   - Expand hosted navigation polish from product feedback.
   - Keep `x-openmemory-user-id` only for local development and tests.

2. MCP production flow
   - Manually test full interactive OAuth callback flows in MCP Inspector,
     Cursor, Claude, and ChatGPT connector surfaces before broad hosted launch.
   - Expand OAuth lifecycle UI from connection revocation into full client
     registration/management if we need first-party clients.

3. RAG pipeline
   - Extend the Queue/Workflow pipeline from source chunks to conversation
     transcript extraction and enrichment.
   - Improve extraction quality with Workers AI once deterministic extraction
     has enough production traces to evaluate.
   - Store embeddings in Vectorize for every chunk and add deeper stale-index diagnostics.
   - Tune deterministic reranking and evaluate an optional LLM/ML reranker.
   - Add an external MemoryBench fixture importer if a stable public corpus is
     selected.
   - Add higher-volume graph performance benchmarks and production telemetry.

4. Web app expansion
   - Expand hosted navigation polish from alpha feedback.
   - Keep the hosted TanStack Start UI as a companion dashboard/control plane; the API and MCP integrations remain the primary product surfaces.
   - Use shadcn dashboard templates, defaults, and theme tokens as the baseline; defer Apple/SwiftUI-specific styling until the product structure is stronger.
   - Expand charts for recall quality, memory growth, stale/superseded memories,
     indexing health, MCP usage, and graph operation latency.
   - Continue hardening the `react-force-graph` explorer and evaluate Sigma.js + Graphology, Reagraph, or React Flow only if graph size and layout requirements outgrow the current approach.
   - Expand browser tests for hosted authenticated profile/team flows and MCP
     connection revocation with seeded grants.

5. CI and deployment
   - Connect Cloudflare Git/Workers Builds to `main`.
   - Keep GitHub CI as quality gate.
   - Use `bun run release:validate` or the manual `Release Qualification`
     workflow before tagging a public alpha.
   - Keep hourly live-smoke passing against production after deploys.
   - Add Cloudflare Notifications or external paging before any higher-volume
     hosted launch.
   - Add a scoped `CLOUDFLARE_API_TOKEN` repository secret only if we keep the GitHub manual deploy fallback.

6. Open-source launch operations
   - Use `docs/launch-announcement.md` for public launch copy and first-feedback
     triage.
   - Convert recurring public feedback into labeled issues and roadmap updates.
