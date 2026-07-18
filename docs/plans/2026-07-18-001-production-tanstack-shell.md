---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
title: Production TanStack Dashboard Shell
created: 2026-07-18
product_contract_source: ce-plan-bootstrap
---

# Production TanStack Dashboard Shell

## Goal Capsule

Production OpenMemory should serve the polished TanStack dashboard at `/` while keeping API, auth, MCP, health, and OAuth consent routes handled by the Cloudflare Worker. The deployed UI must work without manual local-storage setup and the smoke tests should prove that the hosted root is the real dashboard, not the legacy inline Worker page.

## Scope Boundaries

- Do not rework the dashboard design or data model in this pass.
- Do not introduce runtime feature flags or a parallel deployment mode.
- Do not replace the Cloudflare Worker deployment target.
- Do not commit generated `dist` artifacts.

## Key Technical Decisions

- KTD-1 session-settled: Serve `apps/web/dist/client` as Worker Assets from `wrangler.jsonc` and `apps/api/wrangler.jsonc`; route `/api/*`, `/v1/*`, `/mcp`, `/health`, `/login`, `/consent`, and `/.well-known/*` to Worker first. Rationale: this mounts the actual TanStack UI while preserving Elysia/Better Auth/MCP behavior.
- KTD-2 session-settled: Generate `apps/web/dist/client/index.html` after the TanStack build by rendering the SSR server bundle once. Rationale: TanStack Start produces the right asset references but the Worker Assets deployment needs a static shell file.
- KTD-3 session-settled: Remove the legacy inline Worker dashboard route rather than keeping a fallback flag. Rationale: the production root should have one canonical UI surface.
- KTD-4 session-settled: The hosted dashboard defaults API calls to same-origin when running outside localhost. Rationale: users should not need local-storage configuration for production.

## Implementation Units

### U1. Worker Asset Shell

Files:

- Modify `package.json`
- Modify `apps/api/package.json`
- Modify `wrangler.jsonc`
- Modify `apps/api/wrangler.jsonc`
- Modify `apps/api/src/index.ts`
- Create `scripts/render-web-shell.ts`

Approach:

- Add a root build step that runs the existing Turborepo build and then renders the TanStack server bundle to `apps/web/dist/client/index.html`.
- Configure Worker Assets for the web client directory.
- Keep API/auth/MCP/health/login/consent route families on the Worker via `run_worker_first`.
- Remove the inline root dashboard HTML and root Elysia handler.

Test scenarios:

- Local API integration requests to `/` return the TanStack shell with asset references.
- A dry-run deploy can read the Worker entry point and assets config.
- Existing API/auth/MCP routes continue to route through the Worker.

### U2. Production API Origin

Files:

- Modify `apps/web/src/routes/index.tsx`
- Modify or add `apps/web/e2e/dashboard.spec.ts`

Approach:

- Keep localhost as the local development fallback.
- When the dashboard is served from a non-localhost browser origin and the user has no saved API URL, default API calls to `window.location.origin`.
- Avoid SSR/client hydration churn by applying the same-origin default after local storage has loaded.

Test scenarios:

- Production-like browser context without `openmemory:apiUrl` calls same-origin API endpoints.
- Local development behavior remains compatible with the existing API dev server port.

### U3. Smoke and Documentation

Files:

- Modify `apps/api/test/http.integration.test.ts`
- Modify `apps/api/test/live.e2e.test.ts`
- Modify `apps/api/e2e/live-ui.spec.ts`
- Modify `docs/deployment.md`
- Modify `docs/roadmap.md`
- Modify `README.md`

Approach:

- Update local and live smoke assertions to verify the TanStack dashboard shell.
- Update browser E2E selectors to use the TanStack dashboard instead of legacy inline DOM IDs.
- Document the production shell build and routing model.
- Move the production dashboard mount caveat out of the unsolved roadmap list.

Test scenarios:

- Local Miniflare integration covers `/` returning the generated TanStack shell.
- Live API smoke covers `/` returning TanStack shell content.
- Live browser smoke signs in, reaches the TanStack dashboard, and exercises a memory create/recall path where possible.

## Verification Contract

- `bun run build:web-shell`
- `bun run check`
- `bun run test:integration:local`
- `bun run test:e2e:local`
- Wrangler deploy dry-run with the root config
- GitHub CI and live smoke after PR creation

## Definition of Done

- Production root is the TanStack dashboard shell.
- API/auth/MCP routes remain Worker-first.
- Hosted dashboard works with same-origin API defaults.
- Local, integration, and live smoke tests reflect the production UI.
- Docs describe the Cloudflare deployment shape and remaining launch risks accurately.
