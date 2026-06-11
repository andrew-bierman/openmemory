# Graph Memory Architecture Notes

Created: 2026-06-06

## Working Model

OpenMemory needs three cooperating systems:

- Graph memory: canonical, evolving facts and relationships.
- RAG: document/source chunks and semantic retrieval.
- Control/capture: auth, MCP, connectors, UI, exports, and job orchestration.

The graph is not a replacement for embeddings. Embeddings find candidate context; the graph decides whether that context is current, connected, contradicted, superseded, important, or historical.

For this reason, Vectorize is the primary memory retrieval index. Cloudflare AI Search can be layered in for managed document search and built-in MCP/search surfaces, but it should not own canonical memory state.

## Supermemory-Inferred Architecture

Based on public docs, Supermemory likely has:

- Raw documents/sources stored separately from memory units.
- Type-specific extraction and chunking.
- Embeddings for chunks and memory units.
- A graph of memories/facts, not only entity-relation-entity triples.
- Relationship types equivalent to updates, extends, and derives.
- State fields like currentness/latest, temporal validity, memory type, and confidence.
- A retrieval pipeline that combines query understanding, semantic search, graph traversal, temporal filtering, and context assembly.
- MCP, browser extension, SDKs, connectors, and profile APIs as product surfaces over the same memory core.

This is an inference from public docs, not a confirmed internal design.

## Relationship Types

- `updates`: new memory supersedes an older fact.
- `extends`: new memory enriches an existing fact without invalidating it.
- `derives`: new memory is inferred from one or more existing memories.
- `contradicts`: new memory conflicts with an existing memory and needs resolution.
- `mentions`: memory references an entity.
- `belongs_to`: memory/source belongs to user, team, project, conversation, or workspace.
- `supports`: source/chunk supports a memory.
- `similar_to`: approximate relation used for duplicate/merge workflows.

## Canonical Tables Inside Tenant Graph Durable Object

- `sources`: raw captures, uploads, URLs, conversations, files, and integration metadata.
- `chunks`: RAG-oriented chunks with source offsets and Vectorize IDs.
- `memories`: normalized facts/preferences/episodes/insights with currentness and temporal state.
- `entities`: users, people, orgs, repos, projects, files, tools, APIs, places, concepts.
- `memory_entities`: many-to-many links from memories to entities.
- `memory_edges`: typed memory-to-memory and memory-to-entity relationships.
- `jobs`: optional per-graph enrichment state if D1 control-plane jobs are too global.

## Retrieval

Default recall should:

1. Parse time phrases and entities from query.
2. Rewrite short/ambiguous query when AI is available.
3. Query Vectorize for candidate chunks and memories.
4. Load canonical rows from the graph Durable Object.
5. Expand by graph edges with depth and edge-type limits.
6. Filter by tenant, project/team scope, temporal validity, and `isLatest`.
7. Rerank by semantic score, graph distance, edge type, confidence, importance, recall count, recency, and source trust.
8. Return context with provenance and a compact synthesis when requested.

## Feature-Complete Target

- HTTP API compatible with Supermemory-like add/search/document operations.
- MCP tools: `remember`, `recall`, `append`, `update`, `list_recent`, `forget`, `graph_context`, `chat`.
- MCP resources and prompts: profile, projects, recent activity, and a `context` prompt for system-message injection.
- OAuth for browser MCP clients and bearer/API key auth for local/desktop clients.
- User profiles: static profile, dynamic profile, recent activity, and provenance links.
- Capture surfaces: browser extension, bookmarklet, CLI, iOS shortcuts, Obsidian plugin.
- Web UI: recent memories, graph view, source view, conflicts, corrections, exports.
- Frontend stack: TanStack Start with shadcn/ui and an Eden Treaty client generated from the Elysia API type.
- Connectors later: GitHub, Notion, Google Drive, Gmail, Slack, S3, web crawler.
- Admin/operator: R2 export/restore, schema migrations, observability, cost controls.

## Hard Constraints

- Durable Objects are strongly consistent per object, not across objects. Avoid cross-tenant transactions.
- Durable Object SQLite has per-object size limits, so team-scale graphs need sharding or project/entity graph partitioning.
- Workers AI and Vectorize need remote verification; local tests should isolate pure graph logic.
- Automatic memory evolution must be auditable. Store why a fact changed, what source caused it, and what old fact was superseded.
