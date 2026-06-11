---
title: OpenMemory Requirements
status: active
created: 2026-06-06
---

# OpenMemory Requirements

## Problem Frame

AI users repeat context across Claude, Codex, Cursor, ChatGPT, and other tools because memories are trapped in individual chats. The product should provide an open-source, self-hostable memory layer that lets AI tools save, search, evolve, and traverse user memory through a common API.

OpenMemory should not be just RAG over chat transcripts. The product thesis is that memory needs state, time, contradiction handling, and relationships. RAG answers "what content is relevant"; memory answers "what is currently true about this user/team/project, and how did we get there?"

## Primary Actors

- A1 Individual developer: wants personal preferences, project decisions, and recurring context available across tools.
- A2 Small team: wants shared technical decisions and onboarding context available to team agents.
- A3 AI client or MCP client: needs a narrow tool surface for `remember`, `recall`, and graph-aware context lookup.
- A4 Self-hosting operator: wants to deploy the full stack on Cloudflare without managing VMs or external databases.
- A5 Data-capture integration: browser extension, bookmarklet, Obsidian plugin, iOS shortcut, CLI, or webhook that saves context at the moment it is created.

## Key Flows

- F1 Save memory: a client sends content with source, conversation, tags, and metadata; the API stores it in the tenant graph.
- F2 Extract memory: the system turns raw content into smaller fact/memory units, entities, temporal hints, and relationship candidates.
- F3 Resolve memory: the system detects duplicates, contradictions, updates, extensions, derived facts, and ephemeral facts before committing final graph state.
- F4 Recall memory: a client searches natural language and receives relevant current memories using semantic search, graph traversal, temporal filtering, and optional reranking.
- F5 Traverse relationships: a client asks for related context around a memory, entity, conversation, project, or user and receives graph context.
- F6 Inspect and manage: a user or client lists recent memories, updates, appends, forgets, or exports memory for transparency and control.
- F7 Capture from anywhere: CLI, MCP, browser, bookmarklet, iOS shortcut, Obsidian, or webhooks can save memories without each integration inventing storage rules.
- F8 Export/restore: an operator can back up or export tenant graphs to R2 and restore them later.

## MVP Requirements

- R1 Multi-user isolation: memories from one tenant must not be visible to another tenant.
- R2 Durable graph storage: memory records, entities, edges, temporal state, and source links must be stored in SQLite-backed Durable Objects.
- R3 Semantic recall hook: the system should use Workers AI and Vectorize when configured, while retaining keyword/token fallback.
- R4 Open API: the HTTP API should be simple enough for MCP, SDKs, browser extensions, and CLIs to share, and should expose an Elysia `App` type for Eden Treaty clients.
- R5 Cloudflare stack deployability: no required Postgres, Neo4j, Redis, or VM service for the MVP.
- R6 Local development: the repo should run with Bun and Wrangler locally, with documented limitations for remote-only Cloudflare bindings.
- R7 Memory evolution: support relationship types at least equivalent to `updates`, `extends`, `derives`, `contradicts`, `mentions`, and `belongs_to`.
- R8 Temporal validity: memories should track when they were observed, when they are valid, whether they are current, and when they should decay or expire.
- R9 Capture completeness: support raw content capture, appending/updating existing memories, forgetting memories, listing recent items, tags, stats, and chat/synthesis over memories.
- R10 Feature-complete target: first public release should include MCP, API key auth, OAuth for browser MCP clients, web UI, and at least one low-friction capture integration.

## Architecture Thesis

### Data Layers

- Control plane: D1 for users, orgs, API keys, OAuth client registrations, install metadata, and audit logs.
- Tenant graph plane: SQLite-backed Durable Objects for each user/team/project memory graph where consistency and graph mutation matter.
- Semantic index: Vectorize for chunk/memory embeddings. Vectorize is an index, not canonical state.
- Managed search: Cloudflare AI Search can support document knowledge bases, UI snippets, and built-in MCP search, but it is not canonical graph memory.
- Blob/archive plane: R2 for raw uploads, extracted text, backups, large transcripts, and graph exports.
- Async plane: Queues and Workflows for extraction, embeddings, graph linking, contradiction checks, summaries, and exports.
- Cache/config plane: KV for OAuth tokens, dynamic client registrations, short-lived install state, and lightweight configuration.

### Memory Model

- Raw document/source: original captured content or file.
- Chunk: retrieval-oriented content unit for RAG.
- Memory/fact: normalized claim, preference, decision, episode, or inferred insight.
- Entity: user, project, repository, tool, person, organization, file, API, product, or topic mentioned by memories.
- Edge: typed relationship between memories/entities/sources.
- State marker: `isLatest`, confidence, importance, recall count, validity window, decay policy, and provenance.

### Retrieval Pipeline

1. Parse query for entities, time phrases, desired scope, and intent.
2. Embed rewritten query and search Vectorize for candidate chunks/memories.
3. Load canonical candidates from the tenant graph.
4. Expand through graph edges with bounded traversal.
5. Filter stale or superseded facts unless historical context is requested.
6. Rerank by semantic score, graph proximity, recency, importance, confidence, and source trust.
7. Assemble context with citations/provenance and optionally synthesize a concise answer.

## Scope Boundaries

### In Scope For First Milestone

- Bun monorepo scaffold.
- Worker API.
- Elysia + Eden Treaty API contract.
- Durable Object graph store.
- Memory create/get/list/search endpoints.
- Edge create and neighbor endpoints.
- Research and plan documents.
- Architecture docs that make the graph + RAG split explicit.

### Deferred For Later

- MCP server with OAuth.
- Real user/org auth and API key management.
- File ingestion and connector sync.
- TanStack Start + shadcn/ui web app.
- Cloudflare AI Search document-search spike.
- LLM extraction of facts/entities from long conversations.
- R2 export/restore jobs.
- Admin UI and graph visualization.
- Sharding for very large tenant graphs.
- Browser extension, Obsidian plugin, iOS shortcuts, bookmarklet, and CLI.
- Query rewriting, reranking, chat synthesis, duplicate detection, contradiction detection, and automatic forgetting.

### Outside Product Identity

- A hosted proprietary SaaS as the only supported path.
- A generic vector database wrapper with no graph semantics.
- A general-purpose Neo4j replacement.
- A system that silently stores everything forever with no provenance or forgetting controls.

## Acceptance Examples

- AE1 Given two requests with different `x-openmemory-user-id` headers, memories created by one user do not appear in the other's list or search results.
- AE2 Given a memory creation request, the response includes a stable memory ID and the memory can be fetched by ID.
- AE3 Given a search request without Vectorize available, keyword matches still return relevant memory records.
- AE4 Given two memories connected by an edge, the neighbor endpoint returns that relationship.
- AE5 Given Cloudflare AI and Vectorize bindings, the write path indexes the memory and search uses semantic IDs before keyword fallback.
- AE6 Given "Alex works at Google" followed later by "Alex started at Stripe", recall for "where does Alex work?" returns Stripe as current and preserves Google as historical.
- AE7 Given "I have an exam tomorrow", the memory is treated as ephemeral and does not pollute long-term recall after the validity window.
- AE8 Given a long document, the system stores raw source, chunks it for RAG, extracts memory/fact units, links them to entities, and can retrieve both document context and user-specific memory.
- AE9 Given a browser MCP client, OAuth flow works without users putting bearer tokens in URLs.
- AE10 Given a duplicate or near-duplicate memory, the system blocks, merges, or flags it instead of blindly appending.

## Assumptions

- Tenant-level isolation is a better MVP boundary than cross-tenant team/global search.
- A graph plus vector hybrid is required because memory needs relationships, currentness, contradiction handling, and temporal context, not only chunk retrieval.
- Cloudflare Durable Object SQLite limits are acceptable for individual and small-team memory graphs.
- Vectorize direct usage is the right default for memory because graph-currentness and custom reranking require explicit control over candidate IDs and metadata.
- API key auth can be added after the storage and recall model is validated, but MCP OAuth must be part of the public-release bar.
- Supermemory's public docs are product/architecture inspiration, not an exact implementation map.
- Second Brain Cloudflare is a useful product-surface reference, but it is more D1/vector memory than graph memory.

## Open Questions

- Should teams share one graph per org, one graph per user plus shared org graph, or both?
- Which MCP clients should be first-class in the first public release?
- Should graph sharding happen by tenant, project, entity cluster, or time window once a graph approaches Durable Object limits?
- Which LLM calls are acceptable in the write path versus async-only enrichment?
- How much automatic inference should happen before the user has a transparency UI?
- Where should Cloudflare AI Search supplement Vectorize-backed memory retrieval without hiding graph controls?
