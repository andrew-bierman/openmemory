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
configured. Set `OPENMEMORY_ALERT_PAGERDUTY_ROUTING_KEY` to send failed cron
checks to PagerDuty Events API v2 with a stable dedup key per monitored base
URL.

The scheduled CI `Analytics Engine threshold check` job runs every 15 minutes when
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets are
configured. It executes `bun run observability:alerts`, queries Workers
Analytics Engine through Cloudflare's SQL API, and fails the workflow when any
threshold below breaches. The token needs `Account | Account Analytics | Read`
permission, matching Cloudflare's SQL API requirements.

The workflow thresholds are:

- alert on any `openmemory.request_error` in 5 minutes
- alert when 5xx responses exceed 2% for 5 minutes after minimum request volume
- alert when `/v1/search`, `/v1/context`, `/v1/graph/stats`, `/v1/sources`,
  or `/mcp` p95 latency exceeds 2s for 10 minutes
- alert when rate-limited responses exceed 5% for 10 minutes after minimum
  request volume
- alert on any source ingestion or memory extraction worker failure in 5 minutes

Graph/RAG production launch review is tracked separately from alerting in
`config/rag-production-review.json`. Before broad hosted launch, update hosted
graph benchmark trend, semantic RAG trace review, and rerank threshold review
evidence, then run:

```sh
bun run rag:production-review:check
```

GitHub scheduled smoke plus the Worker Cron monitor are the default alpha alert
path. The scheduled CI `Analytics Engine threshold check` job is the first
Analytics Engine-backed threshold path. Cloudflare Notifications, Grafana, or
another dedicated policy destination can mirror those thresholds when broader
operator routing is needed.

## Query Notes

Workers Analytics Engine exposes the dataset through Cloudflare's SQL API. The
saved queries intentionally use basic aggregates (`count`, `avg`, `max`, and
`sum`) so they remain portable across dashboard widgets, API calls, and copied
ad hoc queries.
The executable alert checker uses the same API endpoint,
`https://api.cloudflare.com/client/v4/accounts/<account_id>/analytics_engine/sql`,
and appends `FORMAT JSON` to parse results in Bun.
