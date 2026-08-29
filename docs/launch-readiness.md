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
operations and vendor-specific MCP client dogfooding still need work before a
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
- Graph/RAG production review is tracked in
  `config/rag-production-review.json`; normal CI validates the mixed
  passed/pending status, and the strict launch gate fails until semantic RAG
  trace review and rerank threshold review are recorded.
- Better Auth, OAuth/OIDC discovery, MCP bearer flow, graph recall, semantic
  provider diagnostics, source ingestion, R2 export, tenant readiness snapshots,
  OAuth provider readiness diagnostics, browser-session readiness, and hosted UI
  smoke are covered by tests.
- Hosted GitHub and Google social OAuth sign-in evidence is tracked in
  `config/social-oauth-dogfood.json`; both providers are disabled for alpha and
  should be marked required only after `GITHUB_CLIENT_ID`,
  `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` are
  installed.
- API and MCP recall use the shared graph recall path; semantic candidates are
  included when Vectorize is configured, with an optional Workers AI rerank pass
  behind `OPENMEMORY_RERANK_MODEL` and deterministic fallback.
- Async source and conversation transcript ingestion are covered by local
  Wrangler integration with Queues and Workflows.
- Entity and relationship extraction workers are covered by local Wrangler
  integration with Queues and Workflows.
- The official MCP TypeScript SDK client is dogfooded in CI, and named MCP
  Inspector, Cursor, Claude, and ChatGPT-style request profiles are
  smoke-tested and documented across tools, resources, and prompts.
- Real MCP Inspector, Cursor, Claude, and ChatGPT vendor-surface dogfooding is
  tracked in `config/mcp-vendor-dogfood.json`; normal CI validates the pending
  status, and the strict launch gate fails until required entries pass with
  evidence.
- Local and live browser E2E verify the generic MCP OAuth callback flow with a
  randomized localhost callback listener, consent UI, PKCE token exchange, and
  MCP calls. Live browser E2E proves bearer-token MCP access; local browser E2E
  keeps the development tenant header for the localhost MCP routing path.
- Operational headers and request IDs are live on `/health`.
- Workers Analytics Engine receives request, error, rate-limit, and async
  worker telemetry when deployed with the `OPENMEMORY_ANALYTICS` binding.
- Saved Workers Analytics Engine SQL queries, executable threshold checks,
  graph/RAG performance queries, hourly live-smoke alerting, and a 15-minute
  Worker Cron health monitor cover the alpha operations baseline.
- Deployment docs explain Cloudflare resources, secrets, Git deploys, manual
  fallback deploys, and live smoke.
- `docs/data-model.md` documents the current D1, Durable Object, Vectorize, R2,
  Queue/Workflow, OAuth, MCP, and readiness data shape.
- Launch-evidence pointers are tracked in
  `config/launch-evidence.json` and checked by
  `bun run launch:evidence:check`.
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
- [x] Hosted GitHub and Google social OAuth sign-in is disabled for alpha in
  `config/social-oauth-dogfood.json`.
- [ ] Hosted GitHub and Google social OAuth sign-in has passed with evidence
  after the providers are re-enabled.
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
- [x] Named external MCP request profiles are smoke-tested and documented.
- [ ] Real MCP Inspector, Cursor, Claude, and ChatGPT vendor-surface OAuth
  dogfooding has passed with evidence in `config/mcp-vendor-dogfood.json`.
- [x] Generic browser OAuth callback behavior for MCP clients is verified in
  local and live browser E2E.
- [x] Dashboard-managed public PKCE MCP client registration, listing, and
  disable flows are verified in hosted browser E2E.
- [x] AI chat transcript ingestion stores role-preserving conversation chunks
  with `conversationId` provenance, message-range metadata, graph links, and
  recall coverage.
- [x] Async source and conversation transcript ingestion use Queues and
  Workflows.
- [x] Entity and relationship extraction workers are implemented.
- [x] Larger recall and graph performance benchmarks run in CI or release
  qualification, with JSONL benchmark artifacts for release review.
- [x] Hosted graph benchmark trend has passed with evidence in
  `config/rag-production-review.json`.
- [ ] Semantic RAG trace review and rerank threshold review have passed with evidence in
  `config/rag-production-review.json`.

## Operational Readiness Checklist

- [x] Cloudflare D1, Durable Object, Vectorize, Workers AI, R2, Queues, and
  Workflows bindings are configured.
- [x] Root Wrangler dry-run validates upload shape and bindings.
- [x] Request IDs and structured request logs exist.
- [x] Cloudflare-native global rate limiter exists through a Durable Object.
- [x] Live smoke workflow exists.
- [x] Cloudflare Cron health monitor exists for `/health` and MCP OAuth
  protected-resource metadata, with Analytics Engine telemetry and optional
  webhook/email/PagerDuty alert dispatch.
- [x] Documented repository gate
  `3e4b35fa57c0dfb2d7cc45359858145dbf272813` has green main CI:
  `https://github.com/andrew-bierman/openmemory/actions/runs/29666583941`.
- [x] Documented repository gate
  `3e4b35fa57c0dfb2d7cc45359858145dbf272813` has a green Cloudflare Workers
  Build:
  `https://dash.cloudflare.com/a0adf59e1ef3edc3d2bbc2ff272474bc/workers/services/view/openmemory-api/production/builds/9f6dc277-e53e-4b23-97d7-adbeb425518e`.
- [x] Latest verified runtime candidate
  `3e4b35fa57c0dfb2d7cc45359858145dbf272813` has green live smoke proving
  hosted auth, graph recall, readiness, R2 export, OAuth/MCP, hosted UI, remote
  Workers AI, Vectorize semantic recall, and conversation transcript ingestion:
  `https://github.com/andrew-bierman/openmemory/actions/runs/29666897021`.
- [x] Remote D1 cleanup counters after current live smoke are zero:
  `oauth_client=0`, `live_users=0`, `live_benchmark_users=0`.
- [x] Latest full local release validation evidence passed on
  `3e4b35fa57c0dfb2d7cc45359858145dbf272813` in
  `https://github.com/andrew-bierman/openmemory/actions/runs/29666687105`
  with `bun run release:validate`, including local recall MRR `1.0`, hit@3
  `1.0`, 220-memory graph recall `18.82ms`, 360-memory graph recall
  `21.28ms`, and 1,000-memory graph recall `39.67ms`.
- [x] Latest hosted production graph benchmark evidence passed in
  `https://github.com/andrew-bierman/openmemory/actions/runs/33231544217`:
  trend summary analyzed 10 runs, latest recall latency `2895.96ms`, average
  recall latency `1221.60ms`, and a `12000ms` threshold. The artifact is 956
  bytes and contains only the current benchmark JSONL plus markdown summary.
- [x] Cloudflare WAF or global rate limiting is configured for production abuse
  control.
- [x] Log dashboard or saved queries exist for `openmemory.request`,
  `openmemory.request_error`, 429s, and 5xxs.
- [x] Alerting exists for sustained errors, missing bindings, or auth failures
  through saved queries, the scheduled CI analytics threshold job, hourly
  live smoke, and the Worker Cron health monitor; PagerDuty Events API v2 can
  receive direct cron-failure escalation.
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
