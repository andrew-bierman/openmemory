# OpenMemory Deployment

## Current Deployment

The API is deployed to Cloudflare Workers:

- `https://openmemory-api.abbierman101.workers.dev`
- D1 `openmemory-auth` is bound as `AUTH_DB`.
- Vectorize `openmemory-vectors` is bound as `MEMORY_VECTORS`.
- R2 `openmemory-exports` is bound as `MEMORY_EXPORTS`.
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are set as Worker secrets.

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
- Vectorize index bound as `MEMORY_VECTORS`
- R2 bucket bound as `MEMORY_EXPORTS`
- Remote D1 migrations

The Worker already has Durable Object migrations in `apps/api/wrangler.jsonc`.

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

## Cloudflare Git Deploys

Preferred production deploy path:

1. Connect the GitHub repo to Cloudflare Workers Builds from the Cloudflare dashboard.
2. Use `main` as the production branch.
3. Keep `apps/api/wrangler.jsonc` as the Worker source of truth.
4. Use the dashboard integration for deploy auth instead of storing a deploy token in GitHub.

Run remote D1 migrations before deploying changes that add schema migrations:

```sh
CLOUDFLARE_ACCOUNT_ID=<account-id> bun run db:migrate:remote
```

## GitHub Actions

The default CI workflow runs:

```sh
bun run check
bun run build
```

CI also has an explicit local Wrangler integration job:

```sh
bun run test:integration:local
```

That job is credential-free. It starts Wrangler locally on randomized ports, applies D1 migrations to isolated local state, and exercises the Worker through HTTP against local Durable Object and D1 bindings.

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
