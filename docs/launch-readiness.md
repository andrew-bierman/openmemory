# OpenMemory Launch Readiness

This checklist tracks what must be true before a broader open-source product
launch. It is intentionally evidence-based: items should be checked only when
the current repo, CI, deployment, or runtime behavior proves them.

## Current Launch Posture

OpenMemory is close to an alpha open-source release aimed at technical early
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
- Live production smoke has passed against the deployed Worker, including
  remote Workers AI and Vectorize semantic indexing/recall checks.
- Release validation has passed locally on the current launch candidate,
  including secret scanning, type checks, unit/integration tests, production
  build, MCP SDK smoke, local browser E2E, recall benchmarks, and bounded graph
  scale.
- Hosted production graph benchmark has passed against the deployed Worker with
  an 80-memory throwaway graph, including account cleanup.
- Better Auth, OAuth/OIDC discovery, MCP bearer flow, graph recall, semantic
  provider diagnostics, source ingestion, R2 export, tenant readiness snapshots,
  browser-session readiness, and hosted UI smoke are covered by tests.
- API and MCP recall use the shared graph recall path; semantic candidates are
  included when Vectorize is configured, with an optional Workers AI rerank pass
  behind `OPENMEMORY_RERANK_MODEL` and deterministic fallback.
- Async source ingestion is covered by local Wrangler integration with Queues
  and Workflows.
- Entity and relationship extraction workers are covered by local Wrangler
  integration with Queues and Workflows.
- The official MCP TypeScript SDK client is dogfooded in CI, and named
  Inspector, Cursor, Claude, and ChatGPT-style request profiles are
  smoke-tested and documented across tools, resources, and prompts.
- Operational headers and request IDs are live on `/health`.
- Workers Analytics Engine receives request, error, rate-limit, and async
  worker telemetry when deployed with the `OPENMEMORY_ANALYTICS` binding.
- Saved Workers Analytics Engine SQL queries, graph/RAG performance queries,
  hourly live-smoke alerting, and a 15-minute Worker Cron health monitor cover
  the alpha operations baseline.
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
- [x] MCP endpoint exposes profile/recent resources and a context prompt.
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
- [x] MCP protocol compatibility matrix is tested and documented for tools,
  resources, prompts, and named request profiles.
- [x] Named external MCP clients are dogfooded and documented.
- [x] Async source ingestion uses Queues and Workflows.
- [x] Entity and relationship extraction workers are implemented.
- [x] Larger recall and graph performance benchmarks run in CI or release
  qualification, with JSONL benchmark artifacts for release review.

## Operational Readiness Checklist

- [x] Cloudflare D1, Durable Object, Vectorize, Workers AI, R2, Queues, and
  Workflows bindings are configured.
- [x] Root Wrangler dry-run validates upload shape and bindings.
- [x] Request IDs and structured request logs exist.
- [x] Cloudflare-native global rate limiter exists through a Durable Object.
- [x] Live smoke workflow exists.
- [x] Cloudflare Cron health monitor exists for `/health` and MCP OAuth
  protected-resource metadata, with Analytics Engine telemetry and optional
  webhook/email alert dispatch.
- [x] Latest live smoke proves remote Workers AI and Vectorize semantic recall
  on the current launch candidate. Evidence:
  `https://github.com/andrew-bierman/openmemory/actions/runs/29661917115`
  on `f7914b8ce9b78dc8e320c89c5a228593accb92e1`.
- [x] Latest local release validation passed on
  `f7914b8ce9b78dc8e320c89c5a228593accb92e1` with `bun run
  release:validate`, including local recall MRR `1.0`, hit@3 `1.0`,
  220-memory graph recall `5.95ms`, and 360-memory graph recall `10.85ms`.
- [x] Latest hosted production graph benchmark passed on
  `f7914b8ce9b78dc8e320c89c5a228593accb92e1`: 80 active memories, 79 edges,
  recall latency `1055.43ms` versus a `12000ms` threshold, with remote D1
  cleanup counters at zero for live-smoke and live-benchmark users.
- [x] Cloudflare WAF or global rate limiting is configured for production abuse
  control.
- [x] Log dashboard or saved queries exist for `openmemory.request`,
  `openmemory.request_error`, 429s, and 5xxs.
- [x] Alerting exists for sustained errors, missing bindings, or auth failures
  through saved queries, hourly live smoke, and the Worker Cron health monitor.
- [x] GitHub secret scanning or an equivalent secret-detection control is
  enabled for public contributions.
- [x] Documented rollback procedure includes Worker version rollback and D1
  migration precautions.
- [x] Production data retention and export/delete policy is written.
- [x] R2 export lifecycle policy is code-backed and applied to production.

## Recommended Launch Sequence

1. Keep CI green and require live smoke to pass after each deploy.
2. Publish the launch note from `docs/launch-announcement.md`.
3. Use the first public feedback cycle to prioritize MCP compatibility,
   Cloudflare setup friction, recall quality, security, and dashboard UX.
