# OpenMemory Alpha Launch

OpenMemory is now public alpha: a Cloudflare-native, open-source memory layer
for AI tools and MCP clients.

AI memory should not be trapped inside one closed chat product. OpenMemory gives
developers a self-hostable memory service that can save, search, evolve, and
traverse user or team context through a common API and an OAuth-backed MCP
server.

## What ships in `v0.1.0-alpha.1`

- Cloudflare Worker API built with Elysia, TypeScript, Bun, Turborepo, and
  Drizzle.
- Durable Object SQLite graph store for tenant-isolated memories, edges,
  entities, tags, supersession, and soft forgetting.
- Hybrid recall through keyword search, graph expansion, deterministic
  reranking, Workers AI embeddings, and Vectorize when configured.
- Better Auth email/password sessions plus OAuth 2.1/OIDC discovery and dynamic
  client registration for MCP clients.
- Streamable HTTP MCP endpoint with `remember`, `recall`, `profile`, and
  `forget`.
- Cloudflare-native async pipelines with Queues and Workflows for source
  ingestion and entity/relationship extraction.
- R2 graph exports, index repair, global Durable Object rate limiting, and
  Workers Analytics Engine telemetry.
- TanStack Start dashboard with shadcn-style UI, charts, table filters,
  knowledge map, graph operations signals, MCP setup, account settings, hosted
  profile editing, onboarding empty states, and workspace/team management.
- Testing trophy baseline covering static checks, unit tests, local
  Wrangler/D1/Queues/Workflows integration, browser E2E, MCP SDK smoke, recall
  benchmarks, larger graph-scale checks, Cloudflare Workers Build, and live
  production smoke.

## Who should try it now

This release is for technical early adopters who are comfortable with
Cloudflare Workers, D1, Durable Objects, Vectorize, Workers AI, R2, OAuth, and
MCP.

It is not positioned as a broad self-serve SaaS launch yet. The backend and
Cloudflare-native paths are hardened enough to inspect and build on, while
higher-volume operations, external OAuth callback dogfooding, and larger
third-party benchmark corpus imports remain active work.

## Try it

- Repo: https://github.com/andrew-bierman/openmemory
- Release: https://github.com/andrew-bierman/openmemory/releases/tag/v0.1.0-alpha.1
- Hosted alpha Worker: https://openmemory-api.abbierman101.workers.dev
- Setup docs: [README](../README.md)
- MCP docs: [mcp.md](mcp.md)
- Operations docs: [operations.md](operations.md)

## Feedback we want first

- MCP client compatibility with Inspector, Cursor, Claude, ChatGPT connectors,
  and other Streamable HTTP clients, especially full interactive OAuth callback
  flows.
- Self-hosting friction in Cloudflare account setup, D1 migrations, Vectorize,
  Workers AI, and OAuth provider configuration.
- Recall quality issues where graph expansion or reranking returns stale,
  missing, or weak context.
- Dashboard usability issues in capture, recall, knowledge map inspection, MCP
  setup, workspace/team management, and account flows.
- Security or privacy issues in auth, tenant isolation, exports, deletion,
  tokens, or logs.

## Maintainer triage

Route first public feedback into these labels:

- `mcp-compatibility`: client handshake, OAuth, transport, or tool behavior.
- `cloudflare-setup`: deploy, migration, resource provisioning, bindings, or
  secrets friction.
- `recall-quality`: ranking, graph expansion, stale memory, or benchmark gaps.
- `dashboard-ux`: hosted UI workflows, layout, accessibility, or knowledge map
  issues.
- `security`: auth, tenant isolation, token, export, logging, or disclosure
  concerns.
- `docs`: setup, architecture, operations, or examples that are unclear.

Prioritize reproducible bugs and self-hosting blockers first, then MCP client
compatibility, then recall-quality fixtures, then UI polish.
