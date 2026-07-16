# OpenMemory Launch Readiness

This checklist tracks what must be true before a broader open-source product
launch. It is intentionally evidence-based: items should be checked only when
the current repo, CI, deployment, or runtime behavior proves them.

## Current Launch Posture

OpenMemory is ready for an alpha open-source release aimed at technical early
adopters who are comfortable with Cloudflare Workers, Durable Objects, D1,
Vectorize, Workers AI, R2, OAuth, and MCP.

It is not yet a broad self-serve SaaS launch. The backend is functional and
well covered; the companion UI, larger benchmarks, and production observability
still need work before a larger public push.

## Proven Today

- GitHub repo exists and CI runs on PRs and `main`.
- Cloudflare Workers Builds deploys the monolithic Worker from root
  `wrangler.jsonc`.
- Local CI covers formatting, types, unit tests, Worker integration tests, and
  browser E2E.
- Live production smoke has passed against the deployed Worker.
- Better Auth, OAuth/OIDC discovery, MCP bearer flow, graph recall, source
  ingestion, R2 export, and hosted UI smoke are covered by tests.
- Async source ingestion is covered by local Wrangler integration with Queues
  and Workflows.
- Entity and relationship extraction workers are covered by local Wrangler
  integration with Queues and Workflows.
- The official MCP TypeScript SDK client is dogfooded in CI, and named
  interactive MCP clients are documented for manual OAuth testing.
- Operational headers and request IDs are live on `/health`.
- Deployment docs explain Cloudflare resources, secrets, Git deploys, manual
  fallback deploys, and live smoke.

## Open-Source Repository Checklist

- [x] README explains product value, architecture, setup, testing, deployment,
  MCP, auth, roadmap, and docs.
- [x] License file exists.
- [x] Contribution guide exists.
- [x] Security reporting policy exists.
- [x] Support policy exists.
- [x] Code of conduct exists.
- [x] Changelog exists.
- [x] Issue templates exist.
- [x] Pull request template exists.
- [x] GitHub Discussions enabled for support and design questions.
- [ ] Repository visibility switched from private to public.
- [x] Repository topics set for discovery.
- [x] First tagged alpha release draft created with release notes for
  `v0.1.0-alpha.1`.

## Product Readiness Checklist

- [x] Multi-user isolation through Durable Object tenant naming.
- [x] Production tenant headers rejected; OAuth-backed identity is required.
- [x] Better Auth session and OAuth flows covered by local and live tests.
- [x] MCP endpoint exposes `remember`, `recall`, `profile`, and `forget`.
- [x] Graph memory CRUD, recall, source chunks, exports, and repair paths work.
- [x] Hosted dashboard has capture, recall, table, charts, graph explorer, MCP
  setup, and admin settings.
- [ ] First-party hosted web app has fully polished authenticated navigation,
  account settings, and team/tenant management.
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
- [ ] Log dashboard or saved queries exist for `openmemory.request`,
  `openmemory.request_error`, 429s, and 5xxs.
- [ ] Alerting exists for sustained errors, missing bindings, or auth failures.
- [x] GitHub secret scanning or an equivalent secret-detection control is
  enabled for public contributions.
- [x] Documented rollback procedure includes Worker version rollback and D1
  migration precautions.
- [x] Production data retention and export/delete policy is written.

## Recommended Launch Sequence

1. Keep the repo private until the launch scaffolding PR is merged and CI is
   green.
2. Add repository topics and enable Discussions.
3. Create a tagged alpha release from `main`.
4. Switch repository visibility to public.
5. Publish a short launch note that clearly says alpha, Cloudflare-native, MCP,
   graph memory, and self-hostable.
6. Use the first public feedback cycle to prioritize MCP compatibility, UI
   account polish, and async RAG pipeline work.
