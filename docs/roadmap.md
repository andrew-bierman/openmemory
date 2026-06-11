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

## Not Fully Solved Yet

- Cloudflare resources are not provisioned in production:
  - D1 `AUTH_DB`
  - Vectorize index
  - R2 bucket
  - secrets for `BETTER_AUTH_SECRET`, OAuth providers, and deployment URLs
- Browser auth is not complete:
  - login and consent pages are not yet built
  - deployed API routes still allow local header tenant mode unless hardened by env
  - web app currently uses tenant header mode for local development
- MCP OAuth is wired but not end-to-end tested with a real external MCP client registration and token exchange.
- RAG quality is still basic:
  - no async ingestion pipeline
  - no entity extraction worker
  - no relationship extraction worker
  - no reranker
  - no recall benchmarks
- Graph performance has not been benchmarked against realistic memory volumes.
- CI/CD is not configured.
- Deployment is not wired to Cloudflare environments.

## Next Implementation Tracks

1. Production Cloudflare bindings
   - Create D1, Vectorize, R2, secrets, and Wrangler environments.
   - Apply Drizzle migrations to D1.
   - Document local, preview, and production setup.

2. Auth hardening
   - Build Better Auth login, signup, and consent UI.
   - Move the web app from tenant-header mode to session/OAuth-backed identity.
   - Keep `x-openmemory-user-id` only for local development and tests.

3. MCP production flow
   - Require OAuth for deployed MCP.
   - Test dynamic client registration, token exchange, JWKS verification, and scoped access.

4. RAG pipeline
   - Add ingestion jobs for messages/documents.
   - Extract entities and relationships into the graph.
   - Store embeddings in Vectorize.
   - Combine vector candidates, graph neighbors, profile state, and recency.
   - Add recall quality benchmarks.

5. Web app expansion
   - Add authenticated navigation, memory detail, graph neighbors, profile editor, source ingestion, and MCP connection views.
   - Add browser tests for critical flows.

6. CI and deployment
   - Add GitHub Actions for `bun install`, `bun run check`, and build.
   - Add Cloudflare deploy workflow after resource setup.
