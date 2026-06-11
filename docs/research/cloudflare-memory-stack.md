# OpenMemory Stack Research

Created: 2026-06-06

## Source Findings

- Supermemory's public positioning is "one memory" across AI tools via MCP, with recall, save, and profile-style APIs. Its docs expose document/memory creation and search primitives, and the GitHub README shows MCP configuration plus API examples.
- Supermemory's public concepts docs distinguish documents from memories. Documents are static raw knowledge for RAG; memories are stateful, temporal, personal, and relational facts that evolve over time.
- Supermemory's graph-memory docs describe facts built on top of facts, with relationship types including updates, extends, and derives. The system also tracks currentness with `isLatest`, supports contradiction resolution, handles time-based forgetting, and filters noise.
- Supermemory's SuperRAG docs describe a hybrid retrieval model: content-type-aware extraction/chunking, embeddings, relationship building, reranking, query rewriting, and combined memory + document search.
- Supermemory's current public feature surface also includes direct memory CRUD/versioning, user profiles, connector sync, MCP resources/prompts, SDKs, SMFS filesystem access, and MemoryBench evaluation.
- Boris Tane's Durable Object graph database pattern is directly relevant: a Worker routes by graph ID, each graph maps to one SQLite-backed Durable Object, and the object owns node/edge CRUD plus traversal.
- Boris Tane's contextual RAG implementation is also relevant: it combines contextual chunking, Vectorize, D1/FTS5, query rewriting, reciprocal rank fusion, and LLM reranking, but flags AI cost, latency, storage growth, rate limits, and context-window limits.
- Rahil Patel's Second Brain Cloudflare project is a more feature-complete product reference than Boris's graph demo. It uses Workers, D1, Vectorize, Workers AI, KV, assets, and MCP, with capture/append/update/list/count/tags/stats/chat/MCP endpoints and tests for duplicate detection, contradiction checks, temporal parsing, reranking, and insight synthesis.
- Second Brain's implementation shows practical constraints we should account for early: Vectorize metadata `topK` caps, Workers AI/Vectorize local-dev gaps, D1/Vectorize dual-write consistency, JSON tag filtering limitations, and the need to track exact vector IDs.
- Cloudflare Durable Objects are the right consistency boundary for per-user or per-team memory graphs because each named object has durable storage and strong consistency inside that object.
- Cloudflare's own storage guidance calls out the tradeoff: Durable Objects give more control than D1, but require building database tooling and routing between the Worker and object.
- Vectorize is GA and is intended for embeddings/search workloads from Workers. Workers AI can generate embeddings and query Vectorize from the Worker path.
- Cloudflare AI Search, formerly AutoRAG, is a managed search primitive that can index data sources, apply metadata filters, support hybrid search, and expose built-in MCP endpoints and UI snippets.
- Cloudflare Agents/MCP docs show remote MCP over streamable HTTP and OAuth as the likely integration path after the HTTP API stabilizes.
- Elysia's Cloudflare Worker adapter supports Worker deployment with `.compile()` and bindings through `cloudflare:workers`. Eden Treaty gives a type-safe RPC-like client from the exported Elysia app type.

## Architecture Implications

- Use one Durable Object per tenant graph for structural memory: sources, chunks, facts, entities, relationships, currentness, temporal validity, and traversal.
- Use Vectorize as an auxiliary semantic index, not the source of truth. The Durable Object remains canonical.
- Use Cloudflare AI Search as an optional managed retrieval product for document/search experiences, not the primary memory graph index.
- Use Workers AI for default embeddings, with a future provider abstraction for self-hosters who want OpenAI, Voyage, or local embeddings.
- Use D1 for global control-plane metadata: users, orgs, API keys, OAuth clients, install state, job status, and audit logs.
- Use R2 for graph exports, backups, file uploads, and large raw conversation artifacts.
- Use Queues/Workflows for extraction jobs, embedding, entity linking, contradiction checks, graph linking, summaries, and exports so capture writes stay fast and enrichment can retry.
- Use KV for OAuth tokens/dynamic client registrations and lightweight app config, following the Second Brain Cloudflare pattern.
- Use Elysia + Eden Treaty for API contracts so `apps/web`, MCP tests, and SDKs can consume the Worker API without code generation.
- Add performance benchmarks and pivot gates before broad connector ingestion.

## Architecture Comparison

### Boris Durable Object Graph Database

Strengths:

- Clean graph isolation model: one graph ID maps to one Durable Object with private SQLite.
- Good foundation for nodes, edges, traversal, pathfinding, neighbor queries, and graph visualization.
- Fits multi-tenant graph isolation and avoids external graph database infrastructure.

Limitations for OpenMemory:

- It is a graph database demo, not a memory product.
- It does not solve extraction, embeddings, query rewriting, reranking, currentness, contradiction resolution, forgetting, auth, MCP, or capture surfaces.
- Cross-graph queries and large graphs need explicit sharding/aggregation design.

### Second Brain Cloudflare

Strengths:

- Much closer to a complete self-hosted memory product.
- Includes D1 schema, Vectorize, Workers AI, KV-backed OAuth, assets UI, MCP, and capture surfaces.
- Has practical algorithms/tests for chunking, duplicate detection, contradiction checks, temporal parsing, reranking, smart merge, tags, stats, chat, and insight synthesis.

Limitations for OpenMemory:

- Its canonical data model is D1 entries plus Vectorize IDs, not a rich graph memory store.
- It appears optimized for personal scale and single-token auth first, with OAuth added for browser clients.
- It has product features we want, but the graph model is shallower than Supermemory's public memory thesis.

### Supermemory Public Model

Strengths:

- Clear product thesis: memory is stateful, temporal, relational, and personal; RAG is a separate but complementary retrieval layer.
- Relationship model is product-relevant: updates, extends, derives, plus currentness and forgetting.
- Feature surface includes MCP, browser extension, docs/connectors, SDKs, user profiles, document ingestion, and hybrid search.

Limitations for OpenMemory:

- Public docs describe behavior, not full implementation details.
- Some claims rely on proprietary models or services we must replace with open, configurable Cloudflare-first components.
- We need to decide where to run inference and how much automatic inference to enable by default.

### Vectorize vs Cloudflare AI Search

Vectorize should remain the core recall substrate for graph memory. It lets us choose embedding IDs, metadata, filters, candidate counts, graph expansion strategy, temporal/currentness logic, and reranking behavior before returning context. Those controls matter because memory is not only semantic search; the system has to know which facts are current, what source caused them, which facts were superseded, and how related memories should expand context.

Cloudflare AI Search is still useful. Its managed indexing, hybrid search, metadata filters, built-in MCP endpoint, and UI snippets fit document knowledge bases, tenant file search, docs search, and admin search. The boundary should be explicit: AI Search can provide additional document candidates, while the Durable Object graph remains canonical and Vectorize remains the primary memory-vector index.

## Proposed Target Architecture

1. Capture raw source synchronously through API/MCP/integration.
2. Store raw source metadata in the tenant graph and large payload in R2 when needed.
3. Enqueue enrichment.
4. Extract chunks for RAG and memory/fact candidates for graph memory.
5. Generate embeddings and upsert Vectorize records pointing back to canonical graph IDs.
6. Link entities and candidate relationships.
7. Detect duplicates, contradictions, updates, extensions, derived facts, and ephemeral facts.
8. Commit graph mutations with provenance, confidence, `isLatest`, validity windows, and source links.
9. Retrieve with hybrid semantic search + graph expansion + temporal filtering + reranking.
10. Expose both raw results and synthesized context through HTTP, SDK, MCP, and UI.

## API And App Stack

- API: Elysia on Cloudflare Workers, compiled with the Cloudflare Worker adapter.
- Typed client: Eden Treaty from the exported `App` type.
- Web app: TanStack Start and shadcn/ui after the graph/RAG core has enough behavior to inspect.
- MCP: Cloudflare Workers remote MCP with OAuth for browser/hosted clients and bearer/API-key auth for local desktop clients.

## Known Risks

- Cross-tenant queries are awkward if every tenant is a separate Durable Object. Product should avoid global search in the MVP.
- Durable Object SQLite limits make a single object best for small-to-medium per-user graphs; large org graphs will need sharding.
- Vectorize and Workers AI local development may require `wrangler dev --remote`, so tests should keep core graph behavior independent.
- OAuth for remote MCP is security-sensitive. Defer until API key/local-header auth is replaced with a real auth design.
- LLM-based contradiction/inference can be wrong. Store provenance and confidence, and expose correction tools.
- Write-path enrichment can become slow and costly. Persist first; enrich async by default.
- "Automatic forgetting" must be explainable and reversible where possible.
- Vectorize has candidate return limits, especially with metadata. Retrieval must be scoped and benchmarked rather than assuming arbitrary candidate fanout.
- Durable Object per-tenant graphs are bounded by single-object throughput and per-object storage. Team-scale connectors require sharding decisions.

## Sources

- https://boristane.com/blog/durable-objects-graph-databases/
- https://github.com/boristane/cloudflare-dev-101/tree/main/durable-objects-graph-database
- https://developers.cloudflare.com/durable-objects/
- https://developers.cloudflare.com/workers/platform/storage-options/
- https://developers.cloudflare.com/vectorize/get-started/embeddings/
- https://developers.cloudflare.com/vectorize/get-started/intro/
- https://developers.cloudflare.com/ai-search/
- https://elysiajs.com/integrations/cloudflare-worker
- https://elysiajs.com/eden/overview
- https://elysiajs.com/eden/treaty/overview
- https://developers.cloudflare.com/agents/guides/remote-mcp-server/
- https://developers.cloudflare.com/labs/mcp/
- https://supermemory.ai/mcp/
- https://github.com/supermemoryai/supermemory
- https://raw.githubusercontent.com/supermemoryai/supermemory/main/apps/docs/concepts/graph-memory.mdx
- https://raw.githubusercontent.com/supermemoryai/supermemory/main/apps/docs/concepts/memory-vs-rag.mdx
- https://raw.githubusercontent.com/supermemoryai/supermemory/main/apps/docs/concepts/how-it-works.mdx
- https://raw.githubusercontent.com/supermemoryai/supermemory/main/apps/docs/concepts/super-rag.mdx
- https://supermemory.ai/docs/llms.txt
- https://supermemory.ai/docs/memory-operations
- https://supermemory.ai/docs/search
- https://supermemory.ai/docs/concepts/user-profiles
- https://supermemory.ai/docs/connectors/overview
- https://supermemory.ai/docs/smfs/overview
- https://supermemory.ai/docs/memorybench/overview
- https://github.com/rahilp/second-brain-cloudflare
- https://raw.githubusercontent.com/rahilp/second-brain-cloudflare/main/README.md
- https://raw.githubusercontent.com/rahilp/second-brain-cloudflare/main/src/index.ts
- https://raw.githubusercontent.com/rahilp/second-brain-cloudflare/main/db/schema.sql
- https://raw.githubusercontent.com/rahilp/second-brain-cloudflare/main/wrangler.toml
- https://boristane.com/blog/cloudflare-contextual-rag/
- https://developers.cloudflare.com/vectorize/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/limits/
