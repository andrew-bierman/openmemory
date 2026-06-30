# Testing Strategy

Created: 2026-06-06

OpenMemory should follow the testing trophy: many static/unit tests, a strong integration layer, focused end-to-end tests, and a small number of manual/product checks when UI or provider behavior cannot be fully automated.

## Principles

- Prefer real behavior over mocks at service boundaries that matter: Worker routing, Durable Object storage, tenant isolation, graph mutation, and retrieval response shape.
- Keep external-provider behavior isolated. Workers AI, Vectorize, connector providers, and OAuth vendors should have contract tests and remote smoke tests, but core graph behavior must remain testable offline.
- Never trust default ports. Test servers must allocate explicit random local ports, explicit inspector ports, and isolated persistence directories.
- Use unique tenants per test run so Durable Object state cannot leak across runs.
- Treat provenance, currentness, temporal validity, and tenant isolation as correctness properties, not implementation details.

## Trophy Layers

### Static Checks

- TypeScript strict mode for packages and apps.
- Biome formatting/linting.
- Schema contract type checks for public inputs and outputs.

Command:

```sh
bun run check-types
```

### Unit Tests

Scope:

- Core schema validation.
- Tenant normalization.
- Memory ID generation.
- Retrieval scoring helpers once extracted into pure modules.
- Temporal/currentness helper logic.

Command:

```sh
bun test packages
```

### Integration Tests

Scope:

- Cloudflare Worker HTTP API through Wrangler.
- Durable Object SQLite persistence.
- Per-tenant isolation.
- Auth requirements.
- Memory create/list/get/search.
- Edge idempotency and neighbor traversal.
- Keyword fallback when Workers AI and Vectorize are unavailable locally.

The API integration test starts Wrangler on allocated non-default ports and uses an isolated `--persist-to` directory.

Command:

```sh
bun test apps/api/test
```

### Provider Contract Tests

Scope:

- Workers AI embedding response shape.
- Vectorize upsert/query metadata shape.
- Cloudflare AI Search candidate response shape when configured.
- OAuth/MCP protected-resource metadata.
- Connector webhook payloads.

These should run in a separate remote-capable suite with explicit opt-in environment variables to avoid accidental usage charges.

### End-To-End Tests

Scope:

- MCP remember/recall/context flows.
- Browser capture to API to recall.
- Web UI search/detail/profile/correction flows.
- Export/restore.

Use Playwright or the Codex Browser plugin once the web app exists. These tests should still use explicit non-default ports.

Command for the opt-in live production smoke:

```sh
bun run --cwd apps/api test:live
```

This uses `OPENMEMORY_LIVE_BASE_URL` when provided and otherwise targets the deployed Workers URL. It is intentionally excluded from default `bun run check` runs because it creates real remote auth and memory state.

## Required Regression Fixtures

- Tenant A cannot read Tenant B memories.
- New fact updates old fact and old fact becomes historical.
- Extension preserves both facts as current.
- Derived fact records provenance to source memories.
- Temporary event expires after its validity window.
- Duplicate captures merge or flag rather than append blindly.
- Search can return memory facts and document chunks in one response.
- Profile projection separates stable facts from current focus.
- Forget excludes memory from search but preserves audit trail.
- Context assembly respects token budgets.

## Current Coverage

- Core schema/unit tests in `packages/core/src/index.test.ts`.
- Worker integration test in `apps/api/test/http.integration.test.ts`.
- Client request contract tests in `packages/client/src/index.test.ts`.
- Opt-in production E2E smoke in `apps/api/test/live.e2e.test.ts`.

## Next Coverage Work

- Add Cloudflare Vitest worker-pool tests if we need direct Durable Object method tests without HTTP.
- Add pure retrieval module tests before implementing graph expansion/reranking.
- Add MemoryBench provider once graph-aware recall is available.
- Add browser-level Web UI E2E for sign-in, ingest, recall, graph inspection, and MCP setup.
- Add provider contract tests for Workers AI and Vectorize with explicit remote opt-in.
