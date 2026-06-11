---
title: OpenMemory Implementation Plan
status: active
created: 2026-06-06
origin: docs/brainstorms/openmemory-requirements.md
---

# OpenMemory Implementation Plan

## Problem And Scope

Build the first open-source memory service on the Cloudflare stack: a Bun monorepo with a Worker API, per-tenant Durable Object graph storage, semantic indexing, and a path to feature parity with modern memory products. The current alpha now includes memory lifecycle semantics, profile/context assembly, a minimal MCP JSON-RPC surface, and a Worker-hosted dashboard; the plan continues toward production-grade ingestion, retrieval, auth, UI, and benchmarks.

## Architecture Decisions

- Use `apps/api` for the Cloudflare Worker so later apps can include docs, dashboard, MCP, or browser extension packages.
- Use `packages/core` for shared schemas and types so API, MCP, and SDK packages share contracts.
- Use one Durable Object instance per normalized tenant graph for now. This gives strong tenant isolation and colocates graph operations with SQLite.
- Treat Vectorize as an index, not canonical storage. The Durable Object owns memory records and edges.
- Use Elysia on Cloudflare Workers so the API can export an `App` type for Eden Treaty clients. The Cloudflare adapter is still experimental, so runtime smoke tests matter after framework changes.
- Use temporary header-based tenant identity for development only. Production auth is explicitly deferred.
- Introduce D1 as the control-plane database rather than graph source of truth.
- Model memory evolution explicitly: `updates`, `extends`, `derives`, `contradicts`, source provenance, temporal validity, confidence, and currentness.
- Use Vectorize directly for the core memory recall path. Evaluate Cloudflare AI Search as an optional managed search surface for documents, tenant knowledge bases, and built-in MCP/search UI, but keep graph-aware retrieval under our control.
- Plan the first web UI as `apps/web` with TanStack Start and shadcn/ui once graph/RAG behavior is credible.
- Add performance gates before broad ingestion/connectors: foreground capture latency, recall latency, index lag, stale-vector rate, Durable Object graph size, and Workers AI call count.

## Current Alpha Status

- Implemented: Elysia Worker API, Durable Object SQLite graph store, versioned updates, soft forget, graph edges, profile/context endpoints, optional bearer-token auth, Cloudflare Agents `createMcpHandler` MCP endpoint, Eden Treaty client package, minimal dashboard at `/`, and Wrangler-backed integration tests.
- Still alpha: MCP uses the native streamable HTTP handler but OAuth is not fully wired; dashboard is Worker-hosted HTML rather than TanStack Start/shadcn; semantic indexing is best-effort and local tests use keyword fallback.
- Next hardening target: retrieval pipeline, source/chunk ingestion, index-state repair, D1 control plane, and performance spike.

## Implementation Units

### U1: Monorepo Scaffold

Files:

- `package.json`
- `tsconfig.json`
- `biome.json`
- `.gitignore`
- `README.md`

Approach:

- Create Bun workspaces for `apps/*` and `packages/*`.
- Add scripts for local dev, deploy, typecheck, format, and tests.

Verification:

- `bun install`
- `bun run check-types`

### U2: Shared Core Contracts

Files:

- `packages/core/package.json`
- `packages/core/src/index.ts`

Approach:

- Define Zod schemas for memory creation, search, and graph edges.
- Export normalized tenant IDs and memory ID helpers.

Test scenarios:

- Reject empty memory content.
- Normalize tenant IDs consistently.
- Enforce bounded search limit and tag sizes.

### U3: Worker API

Files:

- `apps/api/package.json`
- `apps/api/wrangler.jsonc`
- `apps/api/src/index.ts`
- `apps/api/src/auth.ts`
- `apps/api/src/env.ts`

Approach:

- Use Elysia routes for health, memory CRUD/list, search, edge creation, and neighbor lookup.
- Export the Elysia app type for Eden Treaty clients and SDK tests.
- Route each request to the tenant Durable Object by normalized user header.
- Add optional Workers AI + Vectorize indexing/search hooks.

Test scenarios:

- Missing tenant header returns 401 for `/v1/*`.
- `GET /health` works without auth.
- Search falls back cleanly when Vectorize/AI are absent.

### U4: Durable Object Graph Store

Files:

- `apps/api/src/memory-graph.ts`

Approach:

- Create SQLite tables for memories and edges inside the Durable Object.
- Implement create/get/list/search/addEdge/getNeighbors methods.
- Keep traversal minimal for MVP; add deeper graph algorithms later.

Test scenarios:

- Created memory can be fetched by ID.
- List orders recent memories first.
- Keyword search returns matches without semantic index.
- Edge creation is idempotent for the same source/relationship/target.
- Neighbor lookup includes inbound and outbound edges.

### U5: Research And Planning Docs

Files:

- `docs/research/cloudflare-memory-stack.md`
- `docs/research/cloudflare-rag-bottlenecks.md`
- `docs/research/supermemory-feature-evaluation.md`
- `docs/brainstorms/openmemory-requirements.md`
- `docs/plans/openmemory-plan.md`

Approach:

- Capture research sources, product requirements, scope boundaries, and next implementation sequence.

Verification:

- Docs reference repo-relative paths and source URLs.
- Deferred scope is explicit enough to prevent MVP drift.

### U6: Graph Memory Schema Upgrade

Files:

- `packages/core/src/index.ts`
- `apps/api/src/memory-graph.ts`
- `packages/core/src/index.test.ts`

Approach:

- Add schemas for sources, entities, extracted memory facts, typed edges, temporal metadata, confidence, importance, and `isLatest`.
- Replace generic edge-only graph with first-class tables for sources, memories, entities, memory_entities, and memory_edges.
- Preserve current simple create/search behavior as compatibility routes while adding richer graph mutation internals.

Test scenarios:

- New update relationship marks previous fact as not latest.
- Extends relationship preserves both memories as current.
- Derived memory records provenance to source memories.
- Expired episodic memory is excluded from default recall.

### U7: Ingestion And Enrichment Pipeline

Files:

- `apps/api/src/index.ts`
- `apps/api/src/ingest/*`
- `apps/api/wrangler.jsonc`

Approach:

- Keep capture fast: persist raw source synchronously, then enqueue extraction/enrichment.
- Use Workers AI for initial extraction, entity linking, contradiction checks, and importance scoring.
- Use R2 for large raw inputs and D1 for job status if needed.

Test scenarios:

- Large raw input stores source and returns queued status.
- Failed enrichment leaves source recoverable.
- Duplicate detection can block, flag, merge, or replace.

### U8: Retrieval Pipeline

Files:

- `apps/api/src/retrieval/*`
- `apps/api/src/index.ts`
- `packages/core/src/index.ts`

Approach:

- Implement query parsing, optional query rewriting, Vectorize candidate lookup, canonical graph load, bounded graph expansion, temporal filtering, and reranking.
- Return both raw results and assembled context for AI clients.

Test scenarios:

- Superseded facts are hidden by default.
- Historical queries can include superseded facts.
- Graph expansion brings in related project/user context not found by vector similarity alone.
- Reranking prefers current, high-confidence, recently reinforced memories.

### U9: MCP And Capture Surface

Files:

- `apps/mcp/*` or `apps/api/src/mcp/*`
- `apps/web/*`
- `apps/browser-extension/*`
- `packages/sdk/*`

Approach:

- Implement MCP tools: `remember`, `recall`, `append`, `update`, `list_recent`, `forget`, `graph_context`, and `chat`.
- Add API key auth for local/desktop clients and OAuth for browser MCP clients.
- Add at least one low-friction capture surface after MCP: browser extension, bookmarklet, CLI, or Obsidian plugin.

Test scenarios:

- Claude Desktop style bearer-token MCP works.
- Browser MCP OAuth flow works without token-in-URL.
- Capture integration can save current page/highlight with source provenance.

### U9.5: Profiles And Context Injection

Files:

- `apps/api/src/profiles/*`
- `apps/api/src/index.ts`
- `packages/core/src/index.ts`

Approach:

- Maintain static and dynamic profile projections from graph memories.
- Link every profile statement back to source memories and documents.
- Expose profile through HTTP and MCP resources.
- Add a `context` prompt shape that combines stable preferences, current focus, and recent activity.

Test scenarios:

- Stable facts remain in static profile after repeated recall.
- Temporary/current-work facts appear in dynamic profile and expire or update.
- Profile statements include provenance.

### U10: Web UI

Files:

- `apps/web/*`
- `packages/sdk/*`

Approach:

- Build a TanStack Start app backed by an Eden Treaty client.
- Use shadcn/ui for dense inspection and correction workflows: recent memories, search, graph neighbors, sources, conflicts, and exports.
- Prioritize operator/debuggability over marketing: users need to inspect why a memory exists, what superseded it, and how retrieval assembled context.

Test scenarios:

- Memory search and detail pages render from the typed API client.
- Graph neighbor view can show inbound/outbound relationships.
- Conflict/correction screens expose provenance and currentness state.

### U11: Retrieval Substrate Evaluation

Files:

- `docs/research/cloudflare-memory-stack.md`
- `apps/api/src/retrieval/*`

Approach:

- Keep Vectorize as the primary memory index because recall must join semantic candidates back to canonical graph IDs, currentness, provenance, temporal windows, and edge expansion.
- Spike Cloudflare AI Search for document-style knowledge bases, public docs, and per-tenant file search where managed indexing, hybrid search, UI snippets, and built-in MCP endpoints are useful.
- Define a boundary so AI Search results can feed retrieval candidates without becoming the canonical memory graph.

Test scenarios:

- Memory recall can hide superseded facts and include historical facts on request.
- AI Search document results can be merged with graph memories without losing source provenance.
- Retrieval still works when AI Search is not configured.

### U12: Feature Parity Benchmarking

Files:

- `docs/research/supermemory-feature-evaluation.md`
- `packages/bench/*`

Approach:

- Add an OpenMemory MemoryBench provider once retrieval has graph expansion.
- Track quality, latency, and context-token cost as separate metrics.
- Build local fixtures for updates, contradictions, temporal forgetting, duplicate handling, profile generation, and provenance.

Test scenarios:

- "Alex moved from Google to Stripe" returns the latest employer and preserves history.
- "Exam tomorrow" expires after the validity window.
- Duplicate captures merge or flag rather than blindly appending.
- Context assembly stays under a configured token budget.

### U13: Cloudflare-Native Performance Spike

Files:

- `docs/research/cloudflare-rag-bottlenecks.md`
- `packages/bench/*`
- `apps/api/src/retrieval/*`

Approach:

- Benchmark the all-Cloudflare path before building broad connectors.
- Measure direct memory write, queued raw ingestion, vector indexing lag, keyword recall, vector recall, graph-expanded recall, reranked recall, and synthesized recall.
- Test Vectorize candidate ceilings with metadata return versus IDs-only return.
- Test Durable Object graph growth and traversal latency at increasing row/edge counts.
- Simulate Vectorize insert/delete failures and verify index repair behavior.
- Define explicit pivot triggers before we are committed to a failing substrate.

Test scenarios:

- P95 direct memory write stays under 250 ms without semantic indexing.
- P95 long-content capture accepted/queued stays under 500 ms.
- P95 recall without synthesis stays under 750 ms.
- P95 recall with synthesis stays under 2.5 s.
- Index lag P95 stays under 5 s at personal scale.
- Stale vector rate stays below 0.1% after repair.
- Candidate quality remains acceptable at Vectorize `topK` 50 with metadata or `topK` 100 IDs-only.

## Risks

- Durable Object methods are easy to exercise through Workers, but direct unit tests need Workers-specific test harnesses.
- Vectorize dimensions must match the embedding model when the index is created.
- Local Wrangler may not fully emulate Workers AI and Vectorize; remote dev is needed for full semantic verification.
- Cloudflare AI Search is valuable for managed search, but its abstraction may hide controls needed for graph-currentness, contradiction handling, custom reranking, and canonical memory IDs.
- A single tenant graph object may hit size/throughput limits for teams; sharding must be designed before large org support.
- Write-path LLM calls improve quality but can make capture slow and expensive; enrichment should be async where possible.
- Automatic inference can create trust problems without provenance, confidence, and a UI for correction.

## Next Milestones

- Finish graph schema upgrade.
- Add D1 control plane and API key auth.
- Add Cloudflare Vitest worker-pool tests for Durable Object behavior.
- Add extraction queue for turning conversation transcripts into facts, entities, temporal state, and edges.
- Add MCP server package with `remember`, `recall`, `append`, `update`, `list_recent`, `forget`, `graph_context`, and `chat`.
- Add OAuth for browser MCP clients.
- Add Eden Treaty SDK package and TanStack Start web shell.
- Run a focused AI Search spike for document ingestion and managed MCP/search UI.
- Add profile projection and MCP `context` prompt.
- Add feature-parity fixtures based on the Supermemory evaluation doc.
- Add Cloudflare-native performance spike before connector work.
- Add R2 export/restore.
- Add web UI for inspection, correction, graph view, and source provenance.
