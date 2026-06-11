# Cloudflare RAG And Memory Bottleneck Assessment

Created: 2026-06-06

## What Was Evaluated

This pass looked at two Cloudflare-native reference implementations:

- Boris Tane's contextual RAG implementation: D1 + Vectorize + Workers AI + FTS5 + query rewriting + reciprocal rank fusion + LLM reranking.
- Rahil Patel's `second-brain-cloudflare`: Workers + D1 + Vectorize + Workers AI + KV + MCP/OAuth + web UI + capture integrations.

I did not find a clearly labeled "fork of Boris" that supersedes both. The closest match to the remembered more featureful implementation is `second-brain-cloudflare`, which appears to be an independent/evolved Cloudflare memory implementation rather than a graph database fork.

## Implementation Patterns Worth Borrowing

### Contextual RAG

Boris's RAG pipeline is strong for document retrieval:

1. Split documents into chunks.
2. Ask an LLM to prepend each chunk with document-aware context.
3. Embed contextualized chunks into Vectorize.
4. Store documents/chunks in D1.
5. Query with rewriting and keyword extraction.
6. Run vector search and SQLite FTS5 search.
7. Merge with reciprocal rank fusion.
8. Rerank with an LLM.
9. Generate final answer from curated chunks.

What to borrow:

- Hybrid retrieval: vector candidates plus FTS/BM25 candidates.
- Reciprocal rank fusion or another score-normalization merge.
- Optional query rewriting for short or ambiguous queries.
- Optional reranking only when quality matters enough to justify latency.
- Contextual chunking for documents, but not necessarily for every memory fact.

What not to copy directly:

- Running an LLM over every chunk synchronously during capture.
- Treating D1 as the canonical memory graph.
- Query-side LLM reranking on every recall request.

### Second Brain Cloudflare

Second Brain is closer to a practical memory product:

- D1 stores canonical entries.
- Vectorize stores vectors with `parentId`, chunk metadata, tags, source, and timestamps.
- Workers AI produces embeddings and LLM-based synthesis/scoring.
- `ctx.waitUntil` defers vector insertion and importance scoring after D1 writes.
- Duplicate detection uses Vectorize first, then optional LLM checks.
- Contradiction/merge/replace decisions are folded into one LLM call for near-duplicate matches.
- Append/update paths track exact `vector_ids` so old vectors can be cleaned up.
- Recall applies temporal parsing, Vectorize retrieval, time-decay reranking, recall frequency, importance score, D1 hydration, and synthesis.
- MCP uses Cloudflare's `createMcpHandler` wrapper rather than raw MCP transport.
- Tests cover chunking, temporal parsing, reranking, contradiction checks, capture, append, update, and smart merge behavior.

What to borrow:

- Store exact vector IDs with canonical memory/chunk rows.
- Use safe update ordering: write canonical state, insert replacement vectors, then delete old vectors.
- Make vector failures non-fatal to canonical writes, but surface index lag/repair state.
- Keep expensive enrichment off the synchronous response path with `ctx.waitUntil`, Queues, or Workflows.
- Cap and document Vectorize candidate behavior.
- Add temporal parsing and time-decay tests early.
- Use `createMcpHandler` for Workers MCP.

What to improve:

- Do not hard-delete contradictory memories. Preserve old facts as historical with `isLatest=false` and an `updates` or `contradicts` edge.
- Avoid tag filtering by `LIKE` over JSON when we can model tags as indexed rows or metadata columns.
- Avoid relying on Vectorize metadata as full source payload; use metadata for routing and hydrate from canonical storage.
- Avoid a single monolithic Worker file.
- Build graph semantics explicitly instead of D1 rows plus vector IDs only.

## Known Cloudflare-Native Bottlenecks

### Vectorize Candidate Ceiling

Cloudflare Vectorize limits `topK` to 50 when returning values or metadata, and 100 without values/metadata. Second Brain explicitly works around this by multiplying requested `topK` and clamping to 50 when `returnMetadata="all"`.

Risk:

- Graph-aware recall may need more than 50 initial candidates when filtering by tenant/project/tags/currentness after vector search.

Mitigations:

- Store tenant/project scope in Vectorize namespaces or indexed metadata so filtering happens before result return.
- Query memory vectors and document chunk vectors separately, each with its own candidate budget.
- Request IDs only where possible, then hydrate from Durable Object storage.
- Use multiple targeted queries for rewritten/entity-expanded queries, then merge/dedupe.
- Benchmark candidate recall quality at `topK` 20, 50, and 100 IDs-only.

Pivot trigger:

- If high-quality recall consistently needs more than 100 vector candidates per query after scoped filtering, Vectorize alone is not enough for the retrieval candidate layer.

### Workers AI Latency And Rate Limits

Boris flags AI cost, latency, rate limits, and context-window limits for contextual RAG. Cloudflare's current Workers AI task limits include default text embedding and text generation rate limits. LLM work on every chunk or every recall will become the first scale bottleneck.

Risk:

- Write path becomes slow if every capture performs extraction, contextualization, duplicate detection, contradiction detection, importance scoring, profile updates, and embedding synchronously.
- Recall path becomes slow if every request does query rewrite, rerank, synthesis, and pattern derivation.

Mitigations:

- Synchronous capture should only persist canonical raw/source state and enqueue enrichment.
- Use `ctx.waitUntil` only for short best-effort tasks; use Queues/Workflows for durable enrichment.
- Gate query rewrite, rerank, and synthesis behind request flags and latency budgets.
- Cache profile/context projections and only regenerate asynchronously.
- Batch embeddings where supported.

Pivot trigger:

- If P95 capture exceeds 500 ms or P95 recall exceeds 1 s without generation, remove more AI work from the foreground path or introduce a non-Cloudflare model provider through AI Gateway.

### Durable Object Single-Object Throughput

Durable Objects are single-threaded per object. Cloudflare documents a soft limit around 1,000 requests per second per individual object, and each SQLite-backed object has a 10 GB paid-plan storage limit. That is fine for a user graph and likely acceptable for small teams, but it is not a single global graph database.

Risk:

- One tenant/team graph Durable Object can become hot.
- Large team connector sync could exceed one-object storage or write throughput.
- Cross-tenant/global analytics are awkward.

Mitigations:

- Keep one graph per user/project/team shard, not one global object.
- Add a sharding design before broad connector sync.
- Store large source bodies in R2, not Durable Object SQLite.
- Keep D1 as control plane and analytics index, not graph source of truth.
- Add R2 export/restore and compaction early.

Pivot trigger:

- If a representative team graph approaches 5 GB or sustained 200 writes/sec in tests, implement sharding before shipping team-scale connectors.

### D1 And SQL Shape Limits

D1 and Durable Object SQLite both have practical SQL limits like 100 bound parameters, 2 MB row/string size, and 100 KB SQL statement length. Second Brain's D1 `IN (...)` hydration and JSON tag filtering are acceptable for personal scale but not ideal for large tenant graphs.

Risk:

- Hydrating many candidate IDs can hit parameter limits.
- JSON tag `LIKE` filtering can become slow and imprecise.
- Large rows can exceed row size if raw source content is stored inline.

Mitigations:

- Hydrate candidate rows in bounded chunks.
- Normalize tags/entities into indexed tables.
- Put large raw content in R2 and keep source offsets/metadata in SQLite.
- Avoid long SQL statements generated from dynamic candidate lists.

Pivot trigger:

- If recall hydration requires more than a few bounded SQL batches per request or tag filtering scans dominate query time, normalize immediately and consider a secondary search/control index.

### D1/Vectorize Dual-Write Consistency

Second Brain treats D1 as canonical and Vectorize as eventually consistent. It records `vector_ids` so cleanup can delete exact vector records. This is the right pattern, but dual writes can still drift when Vectorize insert/delete fails.

Risk:

- Search returns stale vectors whose canonical row is missing.
- Newly stored memories are not semantically searchable for a few seconds.
- Update/append paths can leave orphan vectors.

Mitigations:

- Canonical graph state must always win.
- Store vector index state per memory/chunk: `pending`, `indexed`, `stale`, `failed`.
- Add repair jobs that compare canonical rows to Vectorize IDs.
- Hydrate all Vectorize results from the graph; drop missing or stale rows.
- Expose index lag in admin/debug UI.

Pivot trigger:

- If repair jobs cannot keep stale-vector rate below 0.1% in load tests, introduce a more durable indexing queue/workflow or external vector store.

### Worker Resource Limits

Workers have 128 MB memory, six simultaneous outgoing connections per request, and CPU-time limits. Large document ingestion, large result reranking, and buffering streams can hit these limits before storage does.

Mitigations:

- Stream and chunk large uploads.
- Store file/source bodies in R2.
- Use queues/workflows for ingestion fanout.
- Limit concurrent outbound model/vector/database calls.
- Keep retrieval context assembly token-bounded.

## Early Benchmark Plan

Add a dedicated benchmark suite before implementing full graph memory:

- Ingestion latency: direct memory, long conversation, large document.
- Recall latency: keyword-only, vector-only, graph-expanded, reranked, synthesized.
- Candidate quality: topK 10/20/50/100 IDs-only across memory and document indexes.
- Index lag: time from canonical write to semantic recall availability.
- Stale vector rate after simulated Vectorize failures.
- Durable Object graph growth: row count, storage size, traversal latency.
- Cost model: Workers AI calls per capture and per recall.

Initial budgets:

- Direct memory write P95 under 250 ms without semantic indexing.
- Capture accepted/queued P95 under 500 ms for long raw content.
- Recall without synthesis P95 under 750 ms.
- Recall with synthesis P95 under 2.5 s.
- Index lag P95 under 5 s for personal scale.
- Zero cross-tenant recall leaks.

## Architecture Implications For OpenMemory

- Keep the current Durable Object graph approach for canonical memory.
- Add a separate retrieval pipeline module early, with explicit foreground/background stages.
- Use Vectorize as candidate retrieval, not canonical storage.
- Add FTS5/BM25 inside the tenant graph Durable Object for keyword recall and hybrid search.
- Add Queues/Workflows before serious document ingestion.
- Add index-state fields before append/update/forget get complex.
- Add a benchmark suite before building broad connectors.
- Keep a documented pivot path: external model provider via AI Gateway first, external vector/search store second, external graph database last.

## Sources

- https://boristane.com/blog/cloudflare-contextual-rag/
- https://github.com/rahilp/second-brain-cloudflare
- https://raw.githubusercontent.com/rahilp/second-brain-cloudflare/main/src/index.ts
- https://raw.githubusercontent.com/rahilp/second-brain-cloudflare/main/db/schema.sql
- https://www.reddit.com/r/CloudFlare/comments/1t8y748/built_a_semantic_memory_api_on_workers_d1/
- https://www.reddit.com/r/CloudFlare/comments/1top54u/secondbrain_v140_contradiction_detection/
- https://www.reddit.com/r/CloudFlare/comments/1tf03i3/psa_mcp_servers_hanging_on_cloudflare_workers/
- https://developers.cloudflare.com/vectorize/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/workers-ai/platform/limits/
