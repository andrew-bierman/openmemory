# OpenMemory Observability

OpenMemory writes structured JSON logs and, when the
`OPENMEMORY_ANALYTICS` binding is configured, Cloudflare Workers Analytics
Engine datapoints into the `openmemory_events` dataset.

Cloudflare creates Workers Analytics Engine datasets automatically on first
write after the binding is defined in Wrangler. See
[observability-queries.sql](observability-queries.sql) for saved SQL covering:

- request volume and latency by route
- graph/RAG route p95 latency and slow-request investigation
- `openmemory.request_error`
- 5xx responses by route
- 429/rate-limit pressure
- async source ingestion and memory extraction failures

## Alerting

GitHub Actions runs the `Live Smoke` workflow hourly against the deployed
Worker. Treat a failed scheduled run as a production alert because it covers:

- live API health
- Better Auth session flow
- OAuth/OIDC metadata
- MCP tools
- hosted UI browser smoke

The deployed Worker also has a Cloudflare Cron Trigger that runs every 15
minutes. It checks:

- `/health`
- `/.well-known/oauth-protected-resource/mcp`

The monitor writes `openmemory.scheduled_health` Analytics Engine datapoints on
every run. When a check fails, it logs
`openmemory.scheduled_health_failed` and sends a JSON alert if either
`OPENMEMORY_ALERT_WEBHOOK_URL` or `OPENMEMORY_ALERT_EMAIL_ENDPOINT` is
configured.

For Cloudflare-side alerting, create dashboard or notification policies from the
saved queries:

- alert on any sustained `openmemory.request_error`
- alert when 5xx responses exceed 2% for 5 minutes
- alert when `/v1/search`, `/v1/context`, `/v1/graph/stats`, `/v1/sources`,
  or `/mcp` p95 latency exceeds 2s for 10 minutes
- alert when 429 responses exceed 5% for 10 minutes
- alert on any sustained source ingestion or memory extraction worker failure

GitHub scheduled smoke plus the Worker Cron monitor are the default alpha alert
path. Add Cloudflare Notifications, Grafana, PagerDuty, or another destination
for escalation and multi-recipient routing before a higher-volume public
launch.

## Query Notes

Workers Analytics Engine exposes the dataset through Cloudflare's SQL API. The
saved queries intentionally use basic aggregates (`count`, `avg`, `max`, and
`sum`) so they remain portable across dashboard widgets, API calls, and copied
ad hoc queries.
