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

The application-level limiter is an in-memory per-isolate safety valve. It is
not a globally consistent quota and should be paired with Cloudflare edge
controls before public launch.

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
- Keep `OPENMEMORY_RATE_LIMIT_PER_MINUTE` as an application safety valve. Raise
  it or set `OPENMEMORY_RATE_LIMIT_ENABLED=false` only during controlled
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

Create saved Cloudflare log queries or dashboard filters for:

- `openmemory.request_error`
- `openmemory.request` with `status >= 500`
- `openmemory.request` with `status = 429`
- `openmemory.request` with `status = 401 OR status = 403`
- `/mcp` non-2xx responses
- `/api/auth/*` non-2xx responses
- high `durationMs` on `/v1/search`, `/v1/context`, `/v1/sources`, and `/mcp`

Healthy signals:

- `/health` returns 200 and includes `x-openmemory-request-id`
- 429s are rare under normal UI and MCP usage
- auth failures are isolated to invalid sessions or denied clients
- `openmemory.request_error` stays near zero

## Alerting

Create alerts before broader public launch for:

- sustained 5xx responses for 5 minutes
- sustained `openmemory.request_error`
- sudden 429 spikes
- sustained 401/403 spikes on OAuth or MCP routes
- live smoke failure after deploy
- missing Cloudflare binding or startup/deploy failures

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

- A hard-delete tenant purge endpoint is not implemented.
- R2 export lifecycle expiration is not configured in code.
- Durable Object graph restore is not implemented.
- Formal privacy policy text is not included in this repository.

Recommended operator controls before broader public launch:

- Configure R2 lifecycle rules for export retention, such as deleting alpha
  exports after 30 to 90 days unless a longer retention window is required.
- Document how users request account deletion while the hard-delete workflow is
  not yet automated.
- For account deletion requests, revoke OAuth clients and sessions in D1 and
  treat Durable Object graph deletion as a manual operator task until a tenant
  purge endpoint exists.
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
