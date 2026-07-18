# Privacy Policy

OpenMemory is open-source memory infrastructure for AI tools and MCP clients.
This policy describes the default hosted alpha and the repository's intended
self-hosted behavior.

## Data We Store

OpenMemory may store:

- account identity data such as email, display name, sessions, and OAuth client
  grants in D1
- user or workspace memories, tags, entities, graph edges, ingestion jobs, and
  profile/context summaries in tenant-scoped Durable Objects
- embeddings and vector metadata in Vectorize when Workers AI and Vectorize are
  configured
- graph export files in R2 when exports are requested
- operational telemetry such as request counts, errors, route names, status
  codes, and rate-limit events in Workers Analytics Engine

OpenMemory should not log secrets, OAuth tokens, raw memory contents, private
keys, or full export payloads in operational telemetry.

## How Data Is Used

Stored memory data is used to provide recall, graph traversal, profile/context
summaries, MCP tools, dashboard views, source ingestion, exports, and index
repair. Operational telemetry is used to debug reliability, abuse, and launch
readiness.

## Data Sharing

The hosted alpha runs on Cloudflare services. Data is processed by Cloudflare
Workers, Durable Objects, D1, Vectorize, Workers AI, R2, Queues, Workflows, and
Workers Analytics Engine according to the deployment configuration.

Self-hosters control their own Cloudflare account, configured providers, data
retention, and access policies.

## Export and Deletion

Users can export tenant graph data through `/v1/exports`.

Users can delete their hosted account through `DELETE /v1/account` from an
authenticated session by confirming both email and tenant id. Account deletion
purges tenant graph data, best-effort deletes matching Vectorize ids, and
removes user-owned D1 auth, session, workspace, and OAuth control-plane rows.

Operators can hard-delete a tenant graph through `DELETE /v1/tenant` with a
matching `confirmTenantId`.

R2 export objects are retained according to the operator's configured R2
lifecycle policy. Operators should manually remove export objects when a
stricter deletion request requires it.

## Security

Report security issues according to [SECURITY.md](SECURITY.md). Do not include
secrets, tokens, private user data, or production memory contents in public
issues, discussions, logs, screenshots, or pull requests.

## Status

The hosted service is an alpha. This policy should be reviewed before any
broader self-serve SaaS launch or material change to data processing.
