# Release Qualification

Run release qualification before tagging or publishing a public alpha release.
This is stricter than the normal pull-request loop because it records the
current backend behavior that makes OpenMemory useful: graph-aware recall,
bounded local graph performance, MCP compatibility, auth, and browser flows.

## Required Local Gate

```sh
bun run release:validate
```

The release validation command runs formatting, secret scanning, type checks,
unit/integration tests, the production build, MCP SDK smoke tests, local
Playwright E2E, recall benchmarks, and the heavier opt-in scale gate.

The local browser E2E suite also captures launch-review screenshots under
`.tmp/screenshots/launch-readiness/`. Those artifacts are intentionally ignored
by git and can be regenerated with:

```sh
bun run test:e2e:local
```

For a faster pull-request loop, run the same checks individually:

```sh
bun run format
bun run check
bun run build
bun run test:mcp:sdk
bun run test:integration:local
bun run test:e2e:local
bun run test:benchmark:local
```

The benchmark command runs the focused recall and graph-scale cases from
`apps/api/test/http.integration.test.ts`:

- Golden recall ranking must keep mean reciprocal rank at or above `0.84`.
- MemoryBench-style recall fixtures must keep Hit@3 at or above `0.9`.
- A 220-memory tenant graph must return bounded recall results in under
  `7.5s` on the local Wrangler test runner.

The heavier launch scale gate is:

```sh
bun run test:scale:local
```

It runs the same bounded graph benchmark with `OPENMEMORY_SCALE_GRAPH_SIZE=360`
by default. The test clamps custom sizes between 220 and 1,000 memories so local
runs cannot accidentally create unbounded Durable Object state.

## Optional Live Gate

Run this only when production secrets and Cloudflare resources are configured:

```sh
OPENMEMORY_LIVE_E2E=true bun run --cwd apps/api test:live
```

The live gate exercises the hosted dashboard, Better Auth session flow, OAuth
PKCE, and MCP bearer-token `remember`, `recall`, `profile`, and `forget`.

## Release Evidence

For each release, record:

- commit SHA
- local gate result
- live gate result, if run
- Cloudflare Workers Build result
- known skipped checks or production limitations
- screenshot capture path for the current launch-review pass, when relevant

Do not publish a release as broadly production-ready while launch readiness
still has unchecked operational controls, async ingestion, extraction workers,
or named external MCP client dogfooding.
