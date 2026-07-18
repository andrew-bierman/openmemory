# OpenMemory Deployment

## Current Deployment

The API is deployed to Cloudflare Workers:

- `https://openmemory-api.abbierman101.workers.dev`
- HTTP API, Better Auth routes, the TanStack hosted dashboard, static web
  assets, and `/mcp` currently deploy as one Worker.
- D1 `openmemory-auth` is bound as `AUTH_DB`.
- Durable Object `MemoryGraph` is bound as `MEMORY_GRAPHS`.
- Vectorize `openmemory-vectors` is bound as `MEMORY_VECTORS`.
- Workers AI is bound as `AI` for embeddings and optional recall reranking.
- R2 `openmemory-exports` is bound as `MEMORY_EXPORTS`.
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are set as Worker secrets.

## Deployment Shape

Default to a single Worker deploy for now:

- The backend is the workhorse and owns memory graph logic, auth, Vectorize, exports, and MCP tools.
- The hosted UI is a companion dashboard/control plane served from the same origin so cookies, OAuth redirects, and MCP discovery stay simple.
- The root `wrangler.jsonc` serves `apps/web/dist/client` through Cloudflare
  Worker Assets. API, auth, MCP, health, login, consent, and well-known routes
  are listed in `assets.run_worker_first` so they still hit the Elysia Worker.
- `bun run build` renders the TanStack server bundle once into
  `apps/web/dist/client/index.html`, giving Worker Assets a production shell
  without committing generated files.
- The MCP endpoint uses Cloudflare Agents' `createMcpHandler`, which is Cloudflare's lightweight Worker-native path for streamable HTTP MCP servers.

Split MCP into a dedicated Cloudflare Agents `McpAgent` Worker only when we need session-specific Agent state, separate scaling/isolation, or a different release cadence. The persistent OpenMemory state currently lives in Durable Objects, so a separate MCP Agent would mostly add operational surface area rather than new durability.

If provisioning a new account, authenticate Wrangler first:

```sh
bun --cwd apps/api wrangler login
```

Alternatively, set `CLOUDFLARE_ACCOUNT_ID` for the shell or GitHub Actions.

## Provision Cloudflare Resources

```sh
bun install
bash scripts/setup-cloudflare.sh
```

The script creates:

- D1 database bound as `AUTH_DB`
- Vectorize index bound as `MEMORY_VECTORS`, plus metadata indexes for
  `tenantId`, `status`, and `isLatest`
- R2 bucket bound as `MEMORY_EXPORTS`
- R2 lifecycle policy from `infra/cloudflare/r2-lifecycle.json`
- Workers Analytics Engine dataset bound as `OPENMEMORY_ANALYTICS`
- Queue producer/consumer resources for async source ingestion and memory
  extraction
- Dead-letter queues for failed source ingestion and memory extraction messages
- Remote D1 migrations

The Worker already has Durable Object migrations and the
`SOURCE_INGESTION_WORKFLOW` binding in `apps/api/wrangler.jsonc` and root
`wrangler.jsonc`. Cloudflare creates the Workflow from that Worker config during
deploy.

To re-apply or verify R2 lifecycle policy after bucket changes:

```sh
bun run setup:r2-lifecycle
```

The alpha policy expires tenant graph exports after 90 days and aborts
incomplete multipart uploads after 7 days.

To add or verify the required Vectorize metadata indexes on an existing
environment without recreating other Cloudflare resources:

```sh
bun run setup:vectorize-metadata
```

## Required Secrets

Set these before production deploy:

```sh
bun --cwd apps/api wrangler secret put BETTER_AUTH_SECRET
bun --cwd apps/api wrangler secret put BETTER_AUTH_URL
```

Tenant headers are a localhost-only development mechanism. Deployed HTTP and MCP requests must use OAuth-backed identity.

Optional OAuth login providers:

```sh
bun --cwd apps/api wrangler secret put GITHUB_CLIENT_ID
bun --cwd apps/api wrangler secret put GITHUB_CLIENT_SECRET
bun --cwd apps/api wrangler secret put GOOGLE_CLIENT_ID
bun --cwd apps/api wrangler secret put GOOGLE_CLIENT_SECRET
```

Optional machine-token fallback:

```sh
bun --cwd apps/api wrangler secret put OPENMEMORY_API_TOKEN
```

Optional operational controls can be set as Cloudflare environment variables or
dashboard-managed secrets. `OPENMEMORY_RATE_LIMIT_PER_MINUTE` defaults to `600`
and is enforced globally through a dedicated `MemoryGraph` Durable Object
instance. Set `OPENMEMORY_RATE_LIMIT_ENABLED=false` only for trusted controlled
environments.
Responses include `x-openmemory-request-id`, `x-ratelimit-limit`,
`x-ratelimit-remaining`, `x-ratelimit-reset`, and `x-ratelimit-scope`.

Optional recall reranking can be enabled by setting `OPENMEMORY_RERANK_MODEL`
to a Workers AI text-generation model. When unset, recall uses deterministic
ranking only. `OPENMEMORY_RERANK_TIMEOUT_MS` defaults to `900`; timeout,
malformed model output, or local binding gaps fall back to deterministic order.

## Cloudflare Git Deploys

Preferred production deploy path:

1. Connect the GitHub repo to Cloudflare Workers Builds from the Cloudflare dashboard.
2. Use `main` as the production branch.
3. Keep root `wrangler.jsonc` as the Cloudflare Builds deploy entrypoint, and
   keep `apps/api/wrangler.jsonc` aligned for app-local Wrangler commands.
4. Use the dashboard integration for deploy auth instead of storing a deploy token in GitHub.

Run remote D1 migrations before deploying changes that add schema migrations:

```sh
CLOUDFLARE_ACCOUNT_ID=<account-id> bun run db:migrate:remote
```

The `0003_workspaces.sql` migration creates the account workspace and team
member tables used by `/v1/account` and the hosted admin panel.

## GitHub Actions

The default CI workflow runs:

```sh
bun run check
bun run build
```

`bun run build` runs the package builds and then `bun run web:shell`, which
renders the TanStack dashboard shell expected by Worker Assets.

CI also has an explicit local Wrangler integration job:

```sh
bun run test:integration:local
```

That job is credential-free. It starts Wrangler locally on randomized ports, applies D1 migrations to isolated local state, and exercises the Worker through HTTP against local Durable Object and D1 bindings.

CI also runs the local dashboard browser E2E suite:

```sh
bun run test:e2e:local
```

That job installs Playwright Chromium and starts the local API plus TanStack Start app on explicit non-default ports, then checks the dashboard, graph explorer, admin settings, ingest flow, and MCP setup panel.

The manual `Live Smoke` workflow runs:

```sh
bun run --cwd apps/api test:live
bun run test:e2e:ui
```

It accepts an optional `base_url` input and defaults to the current production Worker URL.

For optional live-smoke cleanup and the fallback manual deploy workflow, configure:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The API token needs permission to operate D1 migrations and, for the fallback deploy workflow, deploy Workers for the target Cloudflare account.

## Docker Test Runner

For a clean Linux reproduction of the local Wrangler integration suite:

```sh
bun run test:integration:docker
```

This builds `Dockerfile.test` through `docker-compose.test.yml` and runs `bun run test:integration:local` inside the container. It is optional for developer machines and CI; use it when investigating host-specific failures or validating a clean environment.

## Deploy

```sh
bun run deploy
```

Or run the `Deploy API` workflow from GitHub Actions after secrets are configured. Prefer Cloudflare Git deploys for normal production releases.

## Operations

See [docs/operations.md](operations.md) for rollback, Cloudflare WAF/global rate
limit recommendations, saved log queries, alerting, and alpha data retention
guidance.
