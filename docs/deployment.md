# OpenMemory Deployment

## Current Blocker

This repository is ready for Cloudflare provisioning, but the local Wrangler session currently cannot retrieve Cloudflare account IDs. Re-authenticate before running setup:

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
bun --cwd apps/api wrangler secret put OPENMEMORY_REQUIRE_OAUTH
```

Use `OPENMEMORY_REQUIRE_OAUTH=true` for production. With that value, regular HTTP API routes stop accepting `x-openmemory-user-id` tenant headers unless `OPENMEMORY_ALLOW_HEADER_TENANT=true` is explicitly set.

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

## GitHub Actions Secrets

For the manual deploy workflow, configure:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The API token needs permission to deploy Workers and operate D1 migrations for this account.

## Deploy

```sh
bun run deploy
```

Or run the `Deploy API` workflow from GitHub Actions after secrets are configured.
