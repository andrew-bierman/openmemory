# Maintenance integration

`wrangler.maintenance.jsonc` selects `apps/api/src/maintenance.ts` explicitly. Normal root and API Wrangler configs remain unchanged. This is a candidate-source integration; it is **not** proof that a bridge built from the currently deployed source is ready.

The maintenance config preserves the normal Worker name, compatibility date/flags, cron, storage, queue, workflow and Durable Object bindings/migrations. Its only changes are the entrypoint, an `ASSETS` binding with `run_worker_first: true`, and `OPENMEMORY_TRAFFIC_MODE: "closed"`. The existing Durable Object and Workflow classes are reexported unchanged.

Only the exact value `open` admits traffic. Missing, invalid and closed values return HTTP 503 JSON with `Cache-Control: no-store` and `Retry-After: 300`, including static assets, SPA paths, authentication, MCP, API, OPTIONS and health requests. Closed cron events are skipped, not replayed. Closed queue batches call `retryAll({ delaySeconds: 300 })` and are never acknowledged by this gate.

When open, the normal worker-first routes go to the application and other requests go through `ASSETS.fetch`, preserving the normal asset/SPA routing. Tests bind the route list to the normal config and compare actual local workerd HTTP responses with the unwrapped application.

## Local verification

Build the existing web shell first (`bun run build:web-shell`), then run with an isolated HOME/XDG_CONFIG_HOME, SSD TMPDIR and no provider credentials:

```sh
node_modules/.bin/vitest run apps/api/test/maintenance.test.ts apps/api/test/maintenance.integration.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
node_modules/.bin/tsc -p apps/api/tsconfig.json --noEmit
node_modules/.bin/tsc -p apps/api/test/tsconfig.json --noEmit
node_modules/.bin/wrangler deploy --dry-run --config wrangler.maintenance.jsonc --outdir /absolute/ssd/artifact-directory
```

The integration test starts serial local Wrangler/workerd instances on unique loopback ports with temporary state and stops only its own processes. It compares normal, default-closed and explicit-open workers, checking actual built JavaScript assets, SPA routes, API health and unknown API paths. Unit tests additionally check invalid mode values, queue and cron dispatch, class identity and complete config parity. This does not send queue messages or run workflow instances in production.

## Deployment prerequisites and limitations

This file is not deployment approval. An exact deployed executable was recovered and qualified through a separate closed-only bridge: SHA256 `1e510aabb9d9c6f5d80d1e004794a1754651198e404cc7fb676196a050669289`, version `2609bb21-b95f-4437-a668-1a08105948a9`. Pinned/current downloads and ETags match, and 63 local HTTP checks plus bundling passed. Git source SHA and original asset bytes/routing remain unknown. Verified metadata matches migration tag `v1`, compatibility date `2026-06-01` and `nodejs_compat`. Evidence is in the sibling SSD results directories `deployed-build` and `deployed-build-bridge`. Recheck exact active build and bindings before any window; do not deploy new authority/schema-dependent code before the migration window is closed. Never deploy the test probe or assume the local-only bridge config is an approved production manifest. Validate deployed asset routing, use 100% deployment routing with no old version receiving traffic, and verify all routes are closed. Configuration changes are not an atomic global traffic switch.

Pause provider queue delivery before closure and check backlog age, retry budget, DLQ and retention. The 300-second retry is an emergency backstop, not indefinite preservation: current finite retries and four-day retention still apply. This gate cannot stop existing requests, `waitUntil`, Workflow runs, direct Durable Object RPC, or other writers. Drain those separately and establish quiescence before migrations. Skipped cron events require operational acknowledgement.

Record a native recovery bookmark and verify the migration ledger and invariants within the approved window. Deploy the candidate closed, verify bindings/assets and invariants, and reopen only after explicit approval. A schema/data change may make old-code rollback unsafe; remain closed and use a compatible forward fix or separately reviewed coordinated recovery. D1 recovery does not atomically restore Durable Objects and can revive grants.

No deployment, migration, queue pause, workflow termination, hosted test write, credential creation or vendor grant is performed by the local tests.

## Isolated queue names

For an isolated deployment, set `MEMORY_EXTRACTION_QUEUE_NAME` and
`SOURCE_INGESTION_QUEUE_NAME` to the exact physical queue names in that
deployment's producer/consumer bindings. Unset variables preserve the production
defaults `openmemory-memory-extraction` and `openmemory-source-ingestion`.
Names must be nonempty and distinct. Unknown queues throw before any handler or
acknowledgement, allowing the configured queue retry/DLQ policy to apply.
Setting the variables does not create queues or change bindings.

The local workerd regression invokes the actual queue entry point with production
and isolated names, invalid configuration, and downstream workflow failure.
Hosted candidate validation and real vendor evidence remain pending.
