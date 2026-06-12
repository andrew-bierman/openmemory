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
- CI and manual deploy workflows are defined in `.github/workflows`.
- Cloudflare production resources are provisioned in the personal account:
  - D1 `openmemory-auth` bound as `AUTH_DB`
  - Vectorize `openmemory-vectors` bound as `MEMORY_VECTORS`
  - R2 `openmemory-exports` bound as `MEMORY_EXPORTS`
  - Worker secrets for `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`
- The API Worker is deployed at `https://openmemory-api.abbierman101.workers.dev`.
- Worker-hosted login, signup, consent, and dashboard flows use Better Auth session cookies.
- `scripts/setup-cloudflare.sh` documents and automates resource creation for a fresh account.

## Not Fully Solved Yet

- Browser auth needs deeper product polish:
  - deployed API routes reject header tenant mode
  - local development still supports tenant headers for tests and fast iteration
  - the TanStack app has session controls but still needs richer authenticated navigation
- MCP OAuth is wired but not end-to-end tested with a real external MCP client registration and token exchange.
- RAG quality is still basic:
  - no async ingestion pipeline
  - no entity extraction worker
  - no relationship extraction worker
  - no reranker
  - no recall benchmarks
- Graph performance has not been benchmarked against realistic memory volumes.
- GitHub Actions are configured, and `CLOUDFLARE_ACCOUNT_ID` is set. Manual deploy still needs a scoped `CLOUDFLARE_API_TOKEN` repository secret.
- Optional GitHub and Google login providers still need OAuth app client IDs and secrets.

## Next Implementation Tracks

1. Auth hardening
   - Expand authenticated navigation and account settings.
   - Keep `x-openmemory-user-id` only for local development and tests.

2. MCP production flow
   - Require OAuth for deployed MCP.
   - Test dynamic client registration, token exchange, JWKS verification, and scoped access.

3. RAG pipeline
   - Add ingestion jobs for messages/documents.
   - Extract entities and relationships into the graph.
   - Store embeddings in Vectorize.
   - Combine vector candidates, graph neighbors, profile state, and recency.
   - Add recall quality benchmarks.

4. Web app expansion
   - Add authenticated navigation, memory detail, graph neighbors, profile editor, source ingestion, and MCP connection views.
   - Add browser tests for critical flows.

5. CI and deployment
   - Add a scoped `CLOUDFLARE_API_TOKEN` repository secret.
   - Run the manual deploy workflow against the provisioned Cloudflare resources.
