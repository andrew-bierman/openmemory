---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
created: 2026-07-17
updated: 2026-07-17
slug: feat-launch-readiness-suite
---

# Launch Readiness Suite

## Goal Capsule

OpenMemory is green on the current alpha gate, but the next launch pass should make production readiness more inspectable and harder to regress: backend data shape and tenant relationships first, then a better hosted control-plane UI, richer evidence artifacts, and tests that cover the critical live-like paths.

## Settled Decisions

- **KTD-001: Cloudflare-native remains the implementation boundary.**  
  Provenance: user-directed. Rejected alternative: moving core graph, auth, MCP, or RAG services off Cloudflare. Reason: the product thesis is an open-source Cloudflare-native memory stack.
- **KTD-002: Drizzle/D1 is the control-plane ORM and database path.**  
  Provenance: user-directed. Rejected alternative: Kysely or ad hoc SQL for auth/workspace persistence. Reason: the repo already uses Drizzle with Better Auth and D1 migrations.
- **KTD-003: Keep the monolithic Worker unless a concrete MCP isolation need appears.**  
  Provenance: user-approved. Rejected alternative: splitting MCP into a separate Worker immediately. Reason: Durable Objects hold product state and the same-origin Worker keeps OAuth/cookie/discovery paths simple.
- **KTD-004: UI should follow shadcn blocks/defaults and TanStack libraries.**  
  Provenance: user-directed. Rejected alternative: custom Apple-styled experimentation as the immediate priority. Reason: shadcn dashboard/sidebar/login patterns are a stronger baseline for a shippable SaaS control plane.
- **KTD-005: Testing trophy bias: heavy integration and E2E over shallow unit-only coverage.**  
  Provenance: user-directed. Rejected alternative: relying mainly on unit tests. Reason: Cloudflare bindings, Durable Objects, OAuth, MCP, and browser state fail at integration boundaries.

Standing conflict policy: if implementation finds a settled decision is infeasible, destructive, or wrong for the current repo, stop and surface the conflict; if it is suboptimal but workable, proceed and record the residual.

## Product Contract

### Requirements

- **R-001 Backend readiness snapshot:** expose one authenticated operational snapshot that summarizes tenant graph, index, auth, MCP, export, async-worker, and binding readiness without leaking secrets.
- **R-002 Relationship/data-shape clarity:** make the graph data model and relationship taxonomy visible to API clients and the dashboard, including source/target direction, category, and tenant-level diagnostics.
- **R-003 Auth and tenant confidence:** strengthen account/workspace APIs and UI evidence so session-backed tenants, local tenant mode, and workspace membership states are understandable and testable.
- **R-004 MCP production confidence:** make MCP discovery, tool scope, OAuth metadata, and client configuration visible in the hosted UI and covered by SDK/integration tests.
- **R-005 UI polish:** move the TanStack dashboard closer to shadcn dashboard block patterns: clear app header, section cards, chart panels, data table, sidebar, empty states, loading/error states, and graph explorer detail surfaces.
- **R-006 Evidence artifacts:** generate committed documentation for data models and screenshot capture instructions, and produce local screenshot artifacts for the user during this run.
- **R-007 Test coverage:** add or expand unit, integration, browser E2E, and release validation coverage for the new readiness and UI surfaces.

### Actors

- **A-001 Hosted user:** signs in through Better Auth, manages workspace/profile, captures memories, recalls context, and inspects graph state.
- **A-002 Local developer:** uses tenant headers, local Wrangler, Docker integration, and release validation to verify changes.
- **A-003 MCP client:** discovers OAuth metadata, registers/authorizes, and calls memory tools through streamable HTTP.
- **A-004 Maintainer/operator:** checks production health, bindings, rate limits, smoke tests, graph/index state, and launch documentation.

### Key Flows

- **F-001 Readiness flow:** operator opens the dashboard or calls `/v1/readiness`, sees safe binding/feature status, graph/index health, and follow-up actions.
- **F-002 Auth/admin flow:** hosted user signs up/signs in, sees session-backed workspace state, edits profile/workspace, invites/removes members, and understands local vs hosted tenant routing.
- **F-003 MCP flow:** user opens MCP panel, copies client config/discovery URLs, sees active/revoked OAuth client grants, and smoke tests remain green.
- **F-004 Knowledge explorer flow:** user views graph density, relationship distribution, filtered graph, selected memory details, and neighbor relationships with readable labels.
- **F-005 Launch evidence flow:** maintainer runs release validation, live smoke, and screenshot capture; docs explain current data model and launch gates.

### Acceptance Examples

- **AE-001:** `GET /v1/readiness` for a valid local tenant returns `200` with tenant id, graph stats, relationship catalog count, binding statuses, auth mode, rate-limit settings, MCP metadata URLs, and safe operational warnings.
- **AE-002:** `GET /v1/readiness` without tenant/session in production-like mode rejects header tenants and does not expose another tenant's data.
- **AE-003:** Dashboard has a visible readiness/operations surface with cards for graph, index, auth, MCP, exports, async workers, and production smoke evidence.
- **AE-004:** Browser E2E captures recall, graph explorer, ingest, MCP, admin/auth, empty/loading/error states where practical, and stores screenshots under ignored local artifacts.
- **AE-005:** Integration tests run through local Wrangler and validate readiness plus graph relationship details on real Durable Object state.
- **AE-006:** Docs include current data-model diagrams/tables for D1 auth/workspaces, Durable Object memory graph entities, Vectorize embeddings, R2 exports, queues/workflows, and MCP/OAuth relationships.

## Technical Plan

### U-001 Backend Readiness Contract

Add a safe readiness endpoint in `apps/api/src/index.ts`, implemented through a focused module such as `apps/api/src/readiness.ts`.

Files:
- `apps/api/src/readiness.ts`
- `apps/api/src/index.ts`
- `packages/client/src/index.ts`
- `apps/api/test/http.integration.test.ts`

Implementation notes:
- Reuse `withTenant`/`resolveTenant` semantics so production header behavior stays unchanged.
- Return only safe status, counts, URLs, feature names, and warning codes. Do not return secrets, raw tokens, full memory contents, or provider secrets.
- Include graph stats from `MemoryGraph.getStats()`, relationship catalog count, Vectorize/AI/R2/Queue/Workflow binding booleans, auth DB availability, rate-limit config, and MCP metadata URLs derived from request origin.
- Add Eden/client method and TypeScript types for the dashboard.

Tests:
- Local Wrangler integration validates success for local tenant, unauthorized without tenant, safe binding booleans, relationship catalog count, and graph stats after seeded data.
- Unit-level type/model assertions validate readiness summary shape if the module has pure helpers.

### U-002 Data Model Documentation and Evidence

Create a durable architecture evidence doc that gives maintainers and users a clear view of the actual data model.

Files:
- `docs/data-model.md`
- `README.md`
- `docs/launch-readiness.md`
- `docs/roadmap.md`

Implementation notes:
- Document D1 tables from `apps/api/src/db/schema.ts`.
- Document Durable Object graph objects: memories, edges, jobs, profile/context, export payload.
- Document relationship taxonomy from `packages/core/src/index.ts`.
- Document Vectorize embedding IDs, R2 export keys, queue/workflow messages, OAuth/MCP metadata, and tenant boundaries.
- Include Mermaid diagrams where helpful, but keep prose and tables readable in GitHub.

Tests:
- Documentation is covered by `bun run check` formatting.
- Links from README and launch readiness are valid relative paths.

### U-003 UI Readiness and shadcn Polish Pass

Add a dashboard operations/readiness view and refine the existing surfaces with shadcn dashboard block patterns.

Files:
- `apps/web/src/routes/index.tsx`
- `apps/web/src/dashboard-components.tsx`
- `apps/web/src/admin-components.tsx`
- `apps/web/src/dashboard-model.ts`
- `apps/web/src/dashboard-model.test.ts`
- `apps/web/src/styles/app.css`
- `packages/ui/src/components/*` if additional primitives are needed

Implementation notes:
- Add a `readiness`/`operations` view or integrate an operations section in the existing dashboard navigation with clear cards and chart/list patterns.
- Reuse current shadcn-style primitives and lucide icons; keep layout close to dashboard/sidebar/data-table block conventions.
- Surface readiness endpoint results, production smoke/deploy links from docs/config where static, auth mode, tenant mode, graph/index health, and binding status.
- Improve empty/error/loading states for each major panel.
- Keep graph explorer wide, with a detail panel that labels selected node relationships and operational warnings.

Tests:
- `apps/web/src/dashboard-model.test.ts` covers readiness model/summary helpers.
- `apps/web/e2e/dashboard.spec.ts` covers operations/readiness, empty state, seeded graph, admin/auth panel, MCP panel, and screenshot capture.

### U-004 MCP and Auth Flow Hardening

Strengthen test and UI coverage around OAuth metadata, MCP config, and workspace state.

Files:
- `apps/api/src/mcp.ts`
- `apps/api/src/better-auth.ts`
- `apps/api/test/http.integration.test.ts`
- `scripts/mcp-sdk-smoke.ts`
- `docs/mcp.md`
- `docs/mcp-compatibility.md`

Implementation notes:
- Confirm protected resource metadata and authorization server metadata are linked in readiness.
- Add or extend integration checks for OAuth issuer URL, scopes, DCR, MCP protected resource header, and missing-scope rejection.
- Add UI copy/config fields for generic streamable HTTP OAuth clients without turning the app into a manual.

Tests:
- Keep `bun run test:mcp:sdk` green.
- Add focused local Wrangler assertions for missing scope/invalid bearer behavior when feasible without making tests brittle.

### U-005 Scale and Release Gates

Tighten release validation docs and add a bounded evidence script for screenshots and optional smoke captures.

Files:
- `package.json`
- `playwright.local.config.ts`
- `apps/web/e2e/dashboard.spec.ts`
- `docs/release-qualification.md`
- `docs/operations.md`

Implementation notes:
- Add a deterministic screenshot/evidence command if it can reuse Playwright without duplicating the E2E suite.
- Keep artifact output under ignored `.tmp/` paths.
- Do not make live smoke mandatory for every PR; keep it manual/scheduled due production dependency.

Tests:
- `bun run release:validate`
- `bun run test:e2e:local`
- New screenshot command if added.

## Dependencies and References

- Existing patterns: `apps/api/src/operational-controls.ts`, `apps/api/src/observability.ts`, `apps/api/src/memory-graph.ts`, `apps/web/src/dashboard-model.ts`, `apps/web/e2e/dashboard.spec.ts`.
- Official shadcn block reference: dashboard with sidebar/charts/data table, sidebar blocks, login/signup blocks from `ui.shadcn.com/blocks`.
- Existing launch docs: `docs/launch-readiness.md`, `docs/release-qualification.md`, `docs/deployment.md`, `docs/mcp.md`, `docs/roadmap.md`.

## Risks and Mitigations

- **Readiness endpoint leaking sensitive state:** return only booleans, counts, safe URLs, and warning codes; test for no secret fields.
- **UI polish expanding scope too far:** focus on operations/readiness and graph/admin polish rather than rebuilding routing or app architecture.
- **Live OAuth clients requiring real third-party setup:** keep local deterministic tests for Better Auth/OAuth Provider metadata and SDK flows; document external client dogfooding gaps separately.
- **Scale tests becoming too slow:** keep CI thresholds bounded and use optional heavier gates for larger datasets.
- **Cloudflare binding behavior differing locally/remotely:** verify local Wrangler integration and keep manual live smoke separate.

## Verification Plan

- `bun run check`
- `bun run build`
- `bun run test:mcp:sdk`
- `bun run test:integration:local`
- `bun run test:e2e:local`
- `bun run test:benchmark:local`
- `bun run test:scale:local`
- `bun run release:validate`
- Manual production `Live Smoke` dispatch after merge if this PR is merged during the run.

## Screenshot Evidence Plan

Capture local screenshots after implementation using explicit non-default ports:

- Recall/table dashboard state.
- Ingest/source state.
- Knowledge graph explorer with selected memory.
- MCP setup/connections state.
- Admin/account/workspace state.
- Operations/readiness state.
- Mobile graph or operations state.

Artifacts should be written under `.tmp/screenshots/` and left uncommitted because `.tmp/` is ignored.
