---
title: "feat: Live safety hardening"
created_at: "2026-07-17"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
origin: user request 2026-07-17
---

# feat: Live safety hardening

## Goal Capsule

### Objective

Ship the final launch-hardening pass for OpenMemory, prioritizing backend data shape and relationship correctness, Cloudflare-native graph/RAG behavior, production-grade tests, polished shadcn/TanStack UI, documentation, and deploy readiness.

### Authority

- User direction across the active OpenMemory thread.
- Current repository state on `main`, including `docs/roadmap.md`, `docs/release-qualification.md`, existing Cloudflare Worker/API/Web/MCP implementation, and current tests.
- External platform references listed in Sources & Research.

### Stop Conditions

- A required change would introduce non-Cloudflare production infrastructure.
- A migration risks irreversible user data loss without an explicit migration path and tests.
- Auth, tenant isolation, MCP authorization metadata, or memory deletion semantics regress.
- The local verification suite cannot be made green or a limitation makes launch unsafe; document the blocker and residual risk instead of hiding it.

## Product Contract

### Problem Frame

OpenMemory is close to a working hosted/open-source memory platform, but the launch bar is higher than "builds locally." The system needs a clearer relationship model, stronger graph/RAG correctness signals, tests that exercise real workflows and scale behavior, and a polished web surface that feels like a credible SaaS instead of a rough internal demo.

### Requirements

- **R1: Canonical relationship model.** Define graph relationship taxonomy in `@openmemory/core` and make API, Durable Object storage, ingestion, recall, and UI consume the same model instead of loose string handling.
- **R2: Relationship-safe graph writes.** Validate and normalize graph edges at API/DO boundaries, including direction, weight, provenance metadata, and stable relationship categories.
- **R3: Graph diagnostics.** Expose relationship distribution, entity connectivity, graph density, and bounded traversal diagnostics so tests and UI can prove graph health.
- **R4: Relationship-aware recall.** Keep semantic recall as the primary path, but use graph context and typed relationships to explain and score memory adjacency where available.
- **R5: Scale confidence.** Add bounded CI-safe integration/benchmark coverage and opt-in heavier local scale checks that exercise graph growth, recall latency, and relationship distribution.
- **R6: Production validation command.** Provide a clear release validation path that runs format, type checks, unit/integration tests, build, MCP checks, browser E2E, and benchmarks with documented expectations.
- **R7: shadcn-first SaaS UI.** Polish the web app around official shadcn patterns: sidebar shell, dashboard cards, charts, data tables, forms, badges, tabs, auth/account/admin surfaces, and responsive layout.
- **R8: Knowledge explorer.** Make the graph explorer useful and visually credible, including relationship filters, memory/entity detail affordances, and chart/table context around the force graph.
- **R9: Auth/admin/MCP readiness.** Preserve Better Auth, tenant isolation, admin workflows, and MCP OAuth/protected resource behavior; add tests where gaps are found.
- **R10: Clean code.** Avoid feature flags and temporary alternate paths. Prefer one coherent, typed implementation with docs and tests.

### Scope Boundaries

- Do not replace Cloudflare Durable Objects/D1/Vectorize/Workers AI with external production services.
- Do not replace Drizzle, Better Auth, Elysia/Eden, Bun, Turborepo, TypeScript, Vitest, TanStack, shadcn, or the existing Cloudflare-native deployment direction.
- Do not commit credentials, OAuth secrets, Cloudflare tokens, generated test artifacts, or local screenshots.
- Do not make the UI a marketing landing page; this pass is a real product app/dashboard.

## Planning Contract

### Known Technical Decisions

- **KTD-1: Cloudflare-native production architecture.** Production storage/compute remains Cloudflare Workers, Durable Objects, D1, Vectorize, Workers AI/AutoRAG where applicable, and Cloudflare MCP hosting patterns.
- **KTD-2: Drizzle is the application ORM.** Kysely remains only if pulled transitively by Better Auth internals; app-owned database code should use Drizzle.
- **KTD-3: Elysia + Eden Treaty for typed RPC.** Hono is not the primary API framework for this repo.
- **KTD-4: TanStack + shadcn for web.** Prefer official shadcn components/blocks and TanStack libraries over bespoke UI primitives.
- **KTD-5: Testing trophy.** Heavy confidence should come from integration/E2E/benchmark coverage, not only unit tests or mocked happy paths.
- **KTD-6: Durable Object SQLite remains the graph runtime.** Relationship correctness and performance should improve inside the Cloudflare-native design before considering a pivot.
- **KTD-7: React force graph is acceptable for the explorer.** Use it with tasteful controls and shadcn surrounding UI rather than hand-rolling force layout behavior.

### Architecture Shape

```
clients / mcp / web
        |
        v
Elysia API + Better Auth + Eden types
        |
        +--> Drizzle + D1: users, tenants, auth/session/account metadata
        |
        +--> Memory Graph Durable Object: memories, entities, typed edges, traversal, diagnostics
        |
        +--> Vectorize / Workers AI: embeddings, semantic recall, optional reranking signals
        |
        v
Relationship-aware recall response: semantic hits + graph context + explanation metadata
```

```
source ingestion / conversation memory
        |
        v
memory extraction signals
        |
        v
core relationship taxonomy + validators
        |
        v
DO edge writes + entity linking + relationship distribution
        |
        v
recall, graph explorer, benchmarks, release diagnostics
```

### Implementation Units

#### U1: Core relationship taxonomy

- Add canonical relationship definitions and helpers in `packages/core/src/index.ts`.
- Include stable categories, direction, default weight, user-facing label, and description.
- Add tests for taxonomy validation, normalization, and export typing.
- Update dependent packages to import the core taxonomy instead of duplicating relationship literals.

#### U2: Graph storage and API diagnostics

- Update `apps/api/src/memory-graph.ts` to validate/normalize edge writes and expose relationship distribution and graph density diagnostics.
- Add or extend API endpoints/client types for graph relationship schema and graph stats.
- Cover tenant isolation, invalid relationship rejection, distribution correctness, and bounded traversal in integration tests.

#### U3: Relationship-aware ingestion and recall

- Route extraction/source ingestion relationship writes through the canonical taxonomy.
- Improve recall explanation metadata to show why graph-adjacent memories were included.
- Add tests proving semantic hits, relationship-adjacent hits, supersession/update edges, and forgotten/archived exclusions.

#### U4: Scale and release validation

- Add CI-safe benchmark coverage for graph growth and recall latency.
- Add an opt-in heavier local scale script/test for larger memory/entity/edge volumes.
- Add a root release validation script and document expected commands in release qualification docs.
- Ensure generated benchmark artifacts are ignored.

#### U5: shadcn app shell polish

- Rework the web shell around shadcn-style sidebar, cards, tabs, badges, buttons, forms, tables, charts, and responsive spacing.
- Keep dense dashboard ergonomics and avoid decorative marketing layouts.
- Add or update Playwright coverage for auth shell, dashboard navigation, memory detail flows, admin views, and responsive rendering.

#### U6: Knowledge explorer polish

- Improve the graph explorer around `react-force-graph-2d` with relationship filters, selected node/edge detail, graph health stats, and coordinated chart/table context.
- Keep interaction smooth and layout stable on desktop and mobile viewports.
- Capture screenshots during browser QA for user review.

#### U7: Auth, MCP, docs, and deploy readiness

- Verify Better Auth/OAuth helpers and MCP protected resource metadata remain correct.
- Add tests for MCP auth metadata and client/tool paths where missing.
- Refresh README, GitHub-facing sections, roadmap, and release qualification docs.
- Run local and, where available, Cloudflare/Wrangler validation without requiring secrets.

## Verification Contract

### Required Local Gates

- `bun run format`
- `bun run check`
- `bun run build`
- `bun run test:mcp:sdk`
- `bun run test:integration:local`
- `bun run test:e2e:local`
- `bun run test:benchmark:local`
- New scale/release validation command added by U4

### Browser QA

- Run the app on non-default ports to avoid other local agents.
- Use Playwright/Chrome screenshots for desktop and mobile views.
- Verify dashboard shell, memory flows, graph explorer, admin/auth surfaces, and responsive layout.

### Definition of Done

- Backend graph/data shape is typed, validated, documented, and covered by integration tests.
- Recall and graph diagnostics show relationship-aware behavior.
- UI is substantially more polished and shadcn-consistent.
- E2E, integration, MCP, benchmark, build, and formatting gates pass locally.
- Docs clearly explain architecture, test coverage, release validation, and remaining launch risks.
- Changes are committed with gitmoji, pushed, opened as a PR, and monitored through CI per the LFG pipeline.

## Sources & Research

- Cloudflare Durable Objects overview: https://developers.cloudflare.com/durable-objects/
- Cloudflare Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- Cloudflare SQLite-backed Durable Object storage API: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- Cloudflare storage options: https://developers.cloudflare.com/workers/platform/storage-options/
- Boris Tane, Durable Objects as graph databases: https://boristane.com/blog/durable-objects-graph-databases/
- shadcn blocks: https://ui.shadcn.com/blocks
- shadcn sidebar: https://ui.shadcn.com/docs/components/sidebar
- shadcn chart: https://ui.shadcn.com/docs/components/chart
- shadcn data table: https://ui.shadcn.com/docs/components/data-table
- MCP authorization spec: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- RFC 9728 OAuth 2.0 Protected Resource Metadata: https://datatracker.ietf.org/doc/html/rfc9728

## Plan Review Notes

- Pipeline mode: no interactive confirmation required.
- The plan is implementation-ready because it identifies concrete files/subsystems, test gates, stop conditions, and launch criteria.
- Confidence review focus: backend relationship correctness and deploy safety are higher priority than additional UI ornamentation.
