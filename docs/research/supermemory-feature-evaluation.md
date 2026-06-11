# Supermemory Feature Evaluation

Created: 2026-06-06

## Evaluation Stance

Supermemory is the benchmark, not the blueprint. Public docs describe the product surface and some architecture concepts, but not enough to clone internals. OpenMemory should target feature parity where the behavior matters, while using Cloudflare-native primitives and an auditable open-source data model.

## Public Feature Surface

### Memory Core

- Direct memory creation for known facts and preferences.
- Soft forgetting so removed memories stop appearing in recall while remaining restorable/auditable.
- Versioned updates where old memories are preserved with `isLatest=false`.
- Static memories for stable identity traits and dynamic memories for evolving facts.
- Relationship-aware graph memory with `updates`, `extends`, and `derives`.
- Automatic extraction from raw conversations/documents into multiple connected memories.
- Automatic forgetting for time-bound episodes and temporary facts.

OpenMemory target:

- Durable Object SQLite owns canonical memories, versions, temporal windows, currentness, confidence, provenance, and relationship edges.
- Memory writes should support both direct fact creation and raw-context ingestion.
- Forgetting should be soft by default, with later hard-delete/export controls for compliance.

### RAG And Search

- Raw content ingestion for text, URLs, files, conversations, and documents.
- Supported media includes documents, images with OCR, spreadsheets, and videos/transcripts.
- Content-type-aware extraction and chunking, including code-aware chunking.
- Hybrid search across extracted memories and document chunks.
- Metadata and container/project scoping.
- Optional reranking and query rewriting.
- Search responses distinguish memory facts from document chunks.

OpenMemory target:

- Vectorize is the primary semantic candidate index for memory and document chunks.
- Durable Object graph filters and expands candidates before final ranking.
- Workers AI handles default embeddings, query rewriting, extraction, and reranking where available.
- Cloudflare AI Search can supplement document search, but the graph remains canonical.
- Code chunking should use an existing parser/chunking library instead of ad hoc string splits.

### Profiles

- Automatically maintained user profiles separate stable background from current focus.
- Profiles complement search by giving one-call broad context before specific recall.
- Profile content is built from ingestion and memory updates.

OpenMemory target:

- Maintain `profile_static` and `profile_dynamic` projections per tenant/container.
- Generate profiles asynchronously from the graph, with provenance links back to memories.
- Expose profiles through HTTP, MCP resources, and the web UI.

### Organization, Multi-Tenancy, And Filtering

- Container tags scope data by user, project, or workspace.
- Metadata filters support typed filtering and boolean structures.
- Project/container scoping is also exposed through MCP headers.

OpenMemory target:

- Model tenant, organization, project/container, and source scopes explicitly.
- Keep tenant isolation at the Durable Object boundary for MVP.
- Add D1 control-plane tables for orgs, users, projects, API keys, OAuth clients, connector installs, and audit logs.

### MCP And Agent Surfaces

- Remote MCP server with OAuth by default and API key fallback.
- MCP tools include memory save/forget, recall, and identity lookup.
- MCP resources include profile and projects.
- MCP prompt provides a context injection message.
- Personal app positioning includes plugins for Claude, Cursor, Codex, OpenCode, and related agent tools.

OpenMemory target:

- Implement remote MCP on Cloudflare Workers using streamable HTTP.
- Tools: `remember`, `recall`, `forget`, `update`, `append`, `list_recent`, `graph_context`, `whoami`, and `chat`.
- Resources: `openmemory://profile`, `openmemory://projects`, `openmemory://recent`, and eventually graph/source resources.
- Prompt: `context`, backed by profile plus recent activity.
- Auth: API key for local/desktop clients, OAuth for hosted/browser clients.

### Connectors And Sync

- Public connector list includes Google Drive, Gmail, Notion, OneDrive, GitHub, Granola, S3, and Web Crawler.
- Connectors use OAuth or direct credentials, with real-time webhooks where possible and scheduled/manual sync otherwise.
- Synced documents flow through the same document processing pipeline.

OpenMemory target:

- Defer broad connectors until graph/RAG core and auth are stable.
- First connector should be GitHub docs or web crawler because they are developer-aligned and easier to validate.
- Use Queues/Workflows for sync jobs, R2 for raw snapshots, D1 for connection state, and Durable Objects for final graph mutations.

### SDKs, API Integrations, And Filesystem Surface

- TypeScript and Python SDKs.
- Integrations for Vercel AI SDK, OpenAI SDK/Agents, LangChain, LangGraph, CrewAI, Agno, Mastra, n8n, Zapier, Claude Code, Codex, OpenCode, and others.
- SMFS mounts a memory container as a filesystem and offers semantic grep plus a live `profile.md`.

OpenMemory target:

- Ship TypeScript SDK first through Eden Treaty and stable REST wrappers.
- Add Python SDK after API contracts settle.
- Add AI SDK/OpenAI tool adapters as thin packages.
- Treat SMFS-style filesystem access as a later differentiator: useful for coding agents, but not needed before memory correctness.

### Evaluation

- MemoryBench is an open-source benchmark framework for comparing memory providers.
- MemScore tracks quality, latency, and context-token cost as a triple rather than a single opaque score.

OpenMemory target:

- Add an OpenMemory MemoryBench provider once recall is graph-aware.
- Track internal quality metrics with the same shape: answer accuracy, search latency, and context tokens.
- Add regression fixtures for updates, contradictions, temporal forgetting, duplicate handling, profile generation, and connector provenance.

## Feature Parity Roadmap

### P0: Credible Memory Core

- Direct memory CRUD with soft forget and versioned update.
- Typed graph relationships: `updates`, `extends`, `derives`, `contradicts`, `mentions`, `supports`, `belongs_to`.
- Tenant/project scoping.
- Vectorize-backed search plus keyword fallback.
- Provenance, confidence, temporal windows, currentness, and source links.

### P1: Raw Context And Hybrid Retrieval

- Raw text/conversation ingestion.
- Async extraction pipeline.
- Source/chunk tables.
- Query rewriting, reranking, temporal filtering, and graph expansion.
- Hybrid memory + chunk search response.

### P2: MCP, Profiles, And UI

- Remote MCP with API key and OAuth.
- Profile resources and `context` prompt.
- TanStack Start + shadcn/ui dashboard for search, recent memories, graph neighbors, conflicts, profile, and source provenance.
- API keys, orgs, projects, and audit trail.

### P3: Connectors And SDK Ecosystem

- GitHub docs connector.
- Web crawler connector.
- TypeScript SDK, Python SDK, AI SDK adapter, OpenAI tools adapter.
- Export/restore through R2.

### P4: Advanced Agent Surfaces

- Filesystem/semantic-grep surface inspired by SMFS.
- Broader connectors: Notion, Google Drive, Gmail, OneDrive, S3, Granola.
- MemoryBench provider and public benchmark reports.

## Gaps To Watch

- Automatic relationship inference can be wrong. OpenMemory needs user-visible provenance, confidence, and correction flows early.
- Personal memory products can over-capture sensitive information. Default retention, source visibility, and deletion semantics need to be explicit.
- Connector sync is operationally heavy. Webhooks, OAuth refresh, provider rate limits, and reprocessing can dominate the roadmap if started too early.
- A single Durable Object per tenant is simple but may not fit large team graphs. Sharding decisions should be made before enterprise/team-scale connector sync.
- Cloudflare AI Search has useful managed features, but relying on it as the core memory index could obscure currentness, graph expansion, and custom reranking controls.

## Sources

- https://supermemory.ai/docs/llms.txt
- https://supermemory.ai/docs/concepts/how-it-works
- https://supermemory.ai/docs/concepts/graph-memory
- https://supermemory.ai/docs/concepts/super-rag
- https://supermemory.ai/docs/add-memories
- https://supermemory.ai/docs/search
- https://supermemory.ai/docs/memory-operations
- https://supermemory.ai/docs/concepts/user-profiles
- https://supermemory.ai/docs/connectors/overview
- https://supermemory.ai/docs/supermemory-mcp/mcp
- https://supermemory.ai/docs/smfs/overview
- https://supermemory.ai/docs/memorybench/overview
- https://supermemory.ai/docs/memorybench/memscore
