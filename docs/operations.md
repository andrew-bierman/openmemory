# OpenMemory Operations Runbook

This runbook is for operators running the alpha Cloudflare deployment. It
documents the minimum launch controls for rollback, incident triage, rate
limits, observability, and data retention.

## Production Surfaces

- Worker: `openmemory-api`
- Production URL: `https://openmemory-api.abbierman101.workers.dev`
- D1 database: `openmemory-auth`
- Durable Object class: `MemoryGraph`
- Vectorize index: `openmemory-vectors`
- R2 bucket: `openmemory-exports`

## Rollback Procedure

Use rollback when a deploy causes sustained 5xxs, auth failures, broken MCP
flows, data-write errors, or unacceptable latency.

1. Confirm the current failure:
   - `curl -i https://openmemory-api.abbierman101.workers.dev/health`
   - search logs for `openmemory.request_error`
   - check 429, 401/403, and 5xx rates
   - capture `x-openmemory-request-id` and Cloudflare ray IDs
2. Prefer Worker version rollback for code-only incidents:
   - Open Cloudflare dashboard -> Workers & Pages -> `openmemory-api` -> Deployments.
   - Select the last known-good version.
   - Roll back or promote that version.
   - Re-run live smoke:

     ```sh
     OPENMEMORY_LIVE_E2E=true bun run --cwd apps/api test:live
     ```

3. Use `main` branch revert only when the bad change is already merged and the
   repository should reflect rollback state:

   ```sh
   git revert <bad-merge-sha>
   bun run check
   bun run build
   ```

   Push through a PR so CI and Cloudflare Builds verify the reverted state.

4. Treat D1 migrations as forward-only unless a migration has a written rollback
   plan. Before deploying migrations:
   - export or snapshot relevant D1 state from the Cloudflare dashboard or CLI
   - document the migration impact in the PR
   - avoid destructive schema changes while the product is alpha

5. Treat Durable Object SQLite data and R2 exports as tenant data. Do not delete
   or rewrite them during rollback unless the incident is a data-integrity issue
   and a tenant-specific recovery plan exists.

## WAF and Global Rate Limiting

OpenMemory enforces application rate limits through a dedicated `MemoryGraph`
Durable Object instance. That gives the Worker a Cloudflare-native global quota
for each request bucket instead of relying on per-isolate memory. Responses
include standard rate-limit headers plus `x-ratelimit-scope`; production should
report `global`.

Configuration:

- `OPENMEMORY_RATE_LIMIT_PER_MINUTE` defaults to `600`.
- `OPENMEMORY_RATE_LIMIT_ENABLED=false` disables the limiter for controlled
  incident mitigation.
- Unit tests still cover the isolate-local fallback, but normal Worker
  deployments use the `MEMORY_GRAPHS` Durable Object binding and report
  `x-ratelimit-scope: global`.

Keep this application limiter paired with Cloudflare edge controls before a
larger public launch.

Recommended Cloudflare controls:

- Enable Cloudflare WAF managed rules for the Worker route.
- Add a rate limiting rule for high-frequency unauthenticated traffic to:
  - `/api/auth/*`
  - `/.well-known/*`
  - `/mcp`
  - `/v1/*`
- Start with conservative challenge or block thresholds, then tune from logs:
  - challenge obvious bursts from a single IP
  - avoid blocking normal MCP clients that perform repeated `tools/call`
  - keep `/health` inexpensive and separately rate limited if needed
- Keep `OPENMEMORY_RATE_LIMIT_PER_MINUTE` as the global application quota.
  Raise it or set `OPENMEMORY_RATE_LIMIT_ENABLED=false` only during controlled
  incident mitigation.

## Logs and Saved Queries

Every Worker response should include `x-openmemory-request-id`. Worker logs emit
structured JSON with:

- `event: "openmemory.request"`
- `requestId`
- `method`
- `path`
- `status`
- `durationMs`
- `rateLimited`
- `colo`

Errors emit:

- `event: "openmemory.request_error"`
- `requestId`
- `message`

Async source ingestion failures emit:

- `event: "openmemory.source_ingestion_error"`
- `sourceId`
- `message`

Async memory extraction failures emit:

- `event: "openmemory.memory_extraction_error"`
- `memoryId`
- `message`

Create saved Cloudflare log queries or dashboard filters for:

- `openmemory.request_error`
- `openmemory.source_ingestion_error`
- `openmemory.memory_extraction_error`
- `openmemory.request` with `status >= 500`
- `openmemory.request` with `status = 429`
- `openmemory.request` with `status = 401 OR status = 403`
- `/mcp` non-2xx responses
- `/api/auth/*` non-2xx responses
- high `durationMs` on `/v1/search`, `/v1/context`, `/v1/sources`, and `/mcp`
- stuck source ingestion jobs where `GET /v1/sources/:sourceId` remains
  `queued` or `processing` beyond the expected document size window

Saved Workers Analytics Engine SQL lives in
[observability-queries.sql](observability-queries.sql), and the broader
observability setup is documented in [observability.md](observability.md).

Healthy signals:

- `/health` returns 200 and includes `x-openmemory-request-id`
- rate-limited responses include `x-ratelimit-scope: global`
- async source ingestion jobs transition from `queued` to `processing` to
  `completed`
- memory extraction updates memory metadata with
  `extraction.strategy = deterministic-worker-v1`
- 429s are rare under normal UI and MCP usage
- auth failures are isolated to invalid sessions or denied clients
- `openmemory.request_error` stays near zero
- `openmemory.source_ingestion_error` stays near zero
- `openmemory.memory_extraction_error` stays near zero

## Alerting

Create alerts before broader public launch for:

- sustained 5xx responses for 5 minutes
- sustained `openmemory.request_error`
- sustained `openmemory.source_ingestion_error`
- sustained `openmemory.memory_extraction_error`
- sudden 429 spikes
- sustained 401/403 spikes on OAuth or MCP routes
- live smoke failure after deploy
- missing Cloudflare binding or startup/deploy failures

The `Live Smoke` GitHub Actions workflow runs hourly and should be treated as
the default alpha alert path. Add Cloudflare Notifications or external paging
before a higher-volume launch.

Suggested first thresholds:

- 5xx: alert when 5xx rate is greater than 2% for 5 minutes
- request errors: alert on any sustained nonzero `openmemory.request_error`
- 429: alert when 429s are greater than 5% of requests for 10 minutes
- auth/MCP: alert on sudden changes rather than absolute volume until normal
  traffic patterns are known

## Data Retention and User Control

Alpha retention policy:

- Memory graph data is retained until the user or authorized client forgets it.
- `DELETE /v1/memories/:id` is a soft-forget operation. It removes the memory
  from active recall but preserves historical graph state for auditability and
  supersession behavior.
- `/v1/exports` writes tenant graph JSON to R2 for operator-controlled backups
  and portability.
- OAuth/MCP connections can be revoked through `/v1/oauth/connections`.
- Better Auth user/session/OAuth rows live in D1.

Current limitations:

- R2 export lifecycle expiration is not configured in code, though
  tenant/account deletion now best-effort removes the deleted tenant's export
  objects when the R2 binding is available.
- Durable Object graph restore is not implemented.

Recommended operator controls before broader public launch:

- Configure R2 lifecycle rules for export retention, such as deleting alpha
  exports after 30 to 90 days unless a longer retention window is required.
- For user-initiated account deletion, call `DELETE /v1/account` from an
  authenticated session with `confirmEmail` and `confirmTenantId`. It purges
  the tenant graph, best-effort deletes Vectorize ids and R2 export objects,
  and removes user-owned D1 auth/workspace/OAuth rows.
- For operator-only graph deletion, use `DELETE /v1/tenant` with
  `confirmTenantId` set to the tenant id shown in `/v1/account` or
  `/v1/readiness`. It also best-effort removes export objects under that tenant
  prefix when `MEMORY_EXPORTS` is bound.
- Treat both deletion paths as destructive. Export any required tenant data
  first through `/v1/exports`.
- Do not use production tenant data for demos, tests, screenshots, or issue
  reproduction.

## Incident Notes

For every production incident, record:

- time window
- deploy version or commit SHA
- affected routes
- sample request IDs and Cloudflare ray IDs
- customer-visible impact
- mitigation or rollback action
- follow-up issue or PR
