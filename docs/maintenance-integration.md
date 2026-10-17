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

This file is not deployment approval. First identify and build the actual deployed source with an equivalent closed bridge; do not deploy new authority/schema-dependent code before the migration window is closed. Validate deployed asset routing, use 100% deployment routing with no old version receiving traffic, and verify all routes are closed. Configuration changes are not an atomic global traffic switch.

Pause provider queue delivery before closure and check backlog age, retry budget, DLQ and retention. The 300-second retry is an emergency backstop, not indefinite preservation: current finite retries and four-day retention still apply. This gate cannot stop existing requests, `waitUntil`, Workflow runs, direct Durable Object RPC, or other writers. Drain those separately and establish quiescence before migrations. Skipped cron events require operational acknowledgement.

Record a native recovery bookmark and verify the migration ledger and invariants within the approved window. Deploy the candidate closed, verify bindings/assets and invariants, and reopen only after explicit approval. A schema/data change may make old-code rollback unsafe; remain closed and use a compatible forward fix or separately reviewed coordinated recovery. D1 recovery does not atomically restore Durable Objects and can revive grants.

No deployment, migration, queue pause, workflow termination, hosted test write, credential creation or vendor grant is performed by the local tests.
