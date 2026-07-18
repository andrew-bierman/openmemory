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

Verify production R2 lifecycle policy before tagging an alpha release:

```sh
CLOUDFLARE_ACCOUNT_ID=<account-id> bun run setup:r2-lifecycle
```

The command applies `infra/cloudflare/r2-lifecycle.json` and lists the active
bucket rules.

The benchmark command runs the focused recall and graph-scale cases from
`apps/api/test/http.integration.test.ts`:

- Golden recall ranking must keep mean reciprocal rank at or above `0.84`.
- MemoryBench-style recall fixtures must keep Hit@3 at or above `0.9`.
- A 220-memory tenant graph must return bounded recall results in under
  `7.5s` on the local Wrangler test runner.

Local benchmark commands write JSONL evidence to
`.tmp/benchmark-reports/benchmark-local.jsonl` and
`.tmp/benchmark-reports/scale-local.jsonl`. Each row includes the generated
timestamp, commit when available, benchmark type, graph size or recall case
count, measured recall latency or quality score, and the threshold asserted by
the test.

The heavier launch scale gate is:

```sh
bun run test:scale:local
```

It runs the same bounded graph benchmark with `OPENMEMORY_SCALE_GRAPH_SIZE=360`
by default. The test clamps custom sizes between 220 and 1,000 memories so local
runs cannot accidentally create unbounded Durable Object state.

To run the largest supported local graph gate explicitly:

```sh
OPENMEMORY_SCALE_GRAPH_SIZE=1000 bun run test:scale:local
```

The hosted production graph benchmark is separate from `release:validate`
because it creates production Durable Object, Vectorize, and auth state for a
throwaway account:

```sh
bun run test:benchmark:live
```

It imports a generated graph export, asserts hosted graph recall latency under
`12s`, deletes the account through `DELETE /v1/account`, and writes
`.tmp/benchmark-reports/live-production.jsonl`. Set
`OPENMEMORY_LIVE_GRAPH_SIZE` to request a size; the live test clamps it between
40 and 160 memories.

The standard live production smoke also repairs and checks the semantic index
for its throwaway account, asserts Workers AI and Vectorize are configured, and
requires at least one hosted recall result with `reason: "semantic"`. This keeps
remote provider coverage explicit while preserving the same account cleanup
path as the rest of live smoke.

External MemoryBench-style fixtures can be converted into an OpenMemory graph
export for local restore/import testing:

```sh
bun run benchmark:import -- fixtures/memorybench.example.jsonl --out .tmp/memorybench-export.json
```

The importer accepts JSON fixture objects with `memories`, `distractors`,
`cases`, and `edges`, or JSONL rows with `kind: "memory"`, `"distractor"`,
`"case"`, or `"edge"`. It validates references and writes a
`GraphExportPayloadSchema`-compatible export, with recall cases preserved under
`stats.cases`.

## Recorded GitHub Gate

Use the manual `Release Qualification` workflow before publishing a release tag
when you want a durable GitHub Actions record. It runs `bun run
release:validate` and, by default, follows it with the 1,000-memory local scale
gate. Set `scale_graph_size` to `0` only when intentionally skipping the
additional high-volume local gate for a maintenance-only release.

The workflow uploads the generated `.tmp/benchmark-reports/*.jsonl` files as a
`benchmark-reports` artifact so release reviewers can compare graph latency and
recall-quality evidence across candidate commits.

## Optional Live Gate

Run this only when production secrets and Cloudflare resources are configured:

```sh
OPENMEMORY_LIVE_E2E=true bun run --cwd apps/api test:live
```

The live gate exercises the hosted dashboard, Better Auth session flow, tenant
readiness snapshot, graph recall, source ingestion, R2 export, OAuth PKCE, and
MCP bearer-token `remember`, `recall`, `profile`, and `forget`. The hosted UI
smoke also verifies the authenticated browser session can fetch readiness
content from the deployed Worker, update profile and workspace settings, invite
and remove a team member, revoke a seeded OAuth/MCP connection, and delete the
test account through the Admin danger zone.

Use the `Live Production Benchmark` workflow for recurring hosted graph
performance evidence. It runs the same live benchmark command, defaults to an
80-memory synthetic graph, runs on a daily schedule, and uploads
`live-production-benchmark` artifacts for comparison across production
deployments. The workflow restores recent successful benchmark artifacts,
combines them with the current run, and uploads
`.tmp/benchmark-reports/live-production-summary.md` with latest, average, best,
worst, threshold, and run-over-run delta summaries.

To generate the same summary from local JSONL files:

```sh
bun run benchmark:trend -- .tmp/benchmark-reports/live-production.jsonl --out .tmp/benchmark-reports/live-production-summary.md
```

## Release Evidence

For each release, record:

- commit SHA
- local gate result
- live gate result, if run
- live production benchmark result, if run
- live production benchmark trend summary, if run
- Cloudflare Workers Build result
- R2 lifecycle policy verification result
- known skipped checks or production limitations
- screenshot capture path for the current launch-review pass, when relevant

Do not publish a release as broadly production-ready while launch readiness
still has unchecked operational controls, async ingestion, extraction workers,
or named external MCP client dogfooding.
