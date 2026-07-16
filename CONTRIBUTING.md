# Contributing to OpenMemory

OpenMemory is an alpha project. Contributions are welcome, but the bar for
backend correctness, Cloudflare compatibility, and tests is intentionally high
because this project stores user memory.

## Development Setup

```sh
bun install
bun run dev:api
bun run dev:web
```

Use non-default ports already configured in the repo. Several agents and local
projects may run on this machine, so avoid assuming default ports are free.

## Before Opening a PR

Run the baseline checks:

```sh
bun run format
bun run security:secrets
bun run check
bun run build
bun run test:integration:local
bun run test:e2e:local
```

For Cloudflare deployment changes, also run:

```sh
CLOUDFLARE_ACCOUNT_ID=<account-id> bunx wrangler versions upload --dry-run
```

For production smoke testing after deploys:

```sh
OPENMEMORY_LIVE_E2E=true bun run --cwd apps/api test:live
```

## Testing Expectations

OpenMemory follows the testing trophy:

- Unit tests for deterministic domain logic and small helpers.
- Integration tests for Worker routes, Durable Objects, D1, Better Auth, OAuth,
  MCP, Vectorize repair paths, graph edges, and RAG flows.
- Browser E2E tests for dashboard and hosted UI behavior.
- Live smoke tests only when a deployed Worker is intentionally targeted.

Behavior changes should include tests at the layer that proves the real
contract. Prefer integration tests when a change crosses HTTP, auth, storage,
MCP, or Cloudflare bindings.

## Architecture Guardrails

- Use Drizzle for OpenMemory-owned database schema and queries.
- Keep Better Auth internals isolated behind the existing auth modules.
- Use Elysia and Eden Treaty for the public API/client contract.
- Keep the Cloudflare-native stack as the default: Workers, Durable Objects,
  D1, Vectorize, Workers AI, R2, Queues, and Workflows.
- Do not add external databases or queues without documenting why Cloudflare
  native services are insufficient.
- Treat tenant isolation and OAuth-backed identity as security-sensitive.
- Keep `x-openmemory-user-id` limited to local development and tests.

## Pull Request Style

Use focused PRs with:

- A concise summary of user-facing or operational impact.
- The validation commands you ran.
- Notes for deployment, migrations, secrets, or rollback when relevant.
- Screenshots for visible UI changes.

Gitmoji commit messages are preferred for this repository.

## Secrets

Never commit `.dev.vars`, `.env`, OAuth client secrets, API tokens, private
keys, exported memory data, or live bearer tokens. CI runs
`bun run security:secrets` on every PR as an equivalent secret-detection control
when GitHub Advanced Security is unavailable.
