# OpenMemory Launch Readiness

This checklist tracks what must be true before a broader open-source product
launch. It is intentionally evidence-based: items should be checked only when
the current repo, CI, deployment, or runtime behavior proves them.

## Current Launch Posture

OpenMemory is ready for an alpha open-source release aimed at technical early
adopters who are comfortable with Cloudflare Workers, Durable Objects, D1,
Vectorize, Workers AI, R2, OAuth, and MCP.

It is not yet a broad self-serve SaaS launch. The backend, companion UI, larger
benchmarks, and alpha telemetry are covered; higher-volume production
operations and full external OAuth callback dogfooding still need work before a
larger hosted push.

## Proven Today

- GitHub repo exists and CI runs on PRs and `main`.
- Cloudflare Workers Builds deploys the monolithic Worker from root
  `wrangler.jsonc`.
- Local CI covers formatting, types, unit tests, Worker integration tests, and
  browser E2E.
- Live production smoke has passed against the deployed Worker.
- Better Auth, OAuth/OIDC discovery, MCP bearer flow, graph recall, source
  ingestion, R2 export, tenant readiness snapshots, browser-session readiness,
  and hosted UI smoke are covered by tests.
- Async source ingestion is covered by local Wrangler integration with Queues
  and Workflows.
- Entity and relationship extraction workers are covered by local Wrangler
  integration with Queues and Workflows.
- The official MCP TypeScript SDK client is dogfooded in CI, and named
  Inspector, Cursor, Claude, and ChatGPT-style request profiles are
  smoke-tested and documented.
- Operational headers and request IDs are live on `/health`.
- Workers Analytics Engine receives request, error, rate-limit, and async
  worker telemetry when deployed with the `OPENMEMORY_ANALYTICS` binding.
- Saved Workers Analytics Engine SQL queries, graph/RAG performance queries,
  and hourly live-smoke alerting cover the alpha operations baseline.
- Deployment docs explain Cloudflare resources, secrets, Git deploys, manual
  fallback deploys, and live smoke.
- `docs/data-model.md` documents the current D1, Durable Object, Vectorize, R2,
  Queue/Workflow, OAuth, MCP, and readiness data shape.
- Public launch copy and first-feedback triage guidance are written in
  `docs/launch-announcement.md`.

## Open-Source Repository Checklist

- [x] README explains product value, architecture, setup, testing, deployment,
  MCP, auth, roadmap, and docs.
- [x] License file exists.
- [x] Contribution guide exists.
- [x] Security reporting policy exists.
- [x] Privacy policy exists.
- [x] Support policy exists.
- [x] Code of conduct exists.
- [x] Changelog exists.
- [x] Issue templates exist.
- [x] Pull request template exists.
- [x] GitHub Discussions enabled for support and design questions.
- [x] Repository visibility switched from private to public.
- [x] Repository topics set for discovery.
- [x] First tagged alpha release published with release notes for
  `v0.1.0-alpha.1`.

## Product Readiness Checklist

- [x] Multi-user isolation through Durable Object tenant naming.
- [x] Production tenant headers rejected; OAuth-backed identity is required.
- [x] Better Auth session and OAuth flows covered by local and live tests.
- [x] MCP endpoint exposes `remember`, `recall`, `profile`, and `forget`.
- [x] Graph memory CRUD, recall, source chunks, exports, restore, and repair
  paths work.
- [x] Tenant graph purge supports account-deletion workflows with explicit
  confirmation and tenant isolation coverage.
- [x] Session-backed account deletion removes graph data and user-owned
  auth/workspace/OAuth control-plane rows plus tenant-scoped R2 exports after
  explicit confirmation.
- [x] Hosted dashboard has capture, recall, table, charts, graph explorer, graph
  operations signals, MCP setup, onboarding, profile editing, and admin
  settings.
- [x] First-party hosted web app has fully polished authenticated navigation,
  account settings, team/tenant management, and confirmed account deletion.
- [x] MCP protocol compatibility matrix is tested and documented.
- [x] Named external MCP clients are dogfooded and documented.
- [x] Async source ingestion uses Queues and Workflows.
- [x] Entity and relationship extraction workers are implemented.
- [x] Larger recall and graph performance benchmarks run in CI or release
  qualification.

## Operational Readiness Checklist

- [x] Cloudflare D1, Durable Object, Vectorize, Workers AI, R2, Queues, and
  Workflows bindings are configured.
- [x] Root Wrangler dry-run validates upload shape and bindings.
- [x] Request IDs and structured request logs exist.
- [x] Cloudflare-native global rate limiter exists through a Durable Object.
- [x] Live smoke workflow exists.
- [x] Cloudflare WAF or global rate limiting is configured for production abuse
  control.
- [x] Log dashboard or saved queries exist for `openmemory.request`,
  `openmemory.request_error`, 429s, and 5xxs.
- [x] Alerting exists for sustained errors, missing bindings, or auth failures.
- [x] GitHub secret scanning or an equivalent secret-detection control is
  enabled for public contributions.
- [x] Documented rollback procedure includes Worker version rollback and D1
  migration precautions.
- [x] Production data retention and export/delete policy is written.

## Recommended Launch Sequence

1. Keep CI and live smoke green after each deploy.
2. Publish the launch note from `docs/launch-announcement.md`.
3. Use the first public feedback cycle to prioritize MCP compatibility,
   Cloudflare setup friction, recall quality, security, and dashboard UX.
