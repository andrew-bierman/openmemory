// biome-ignore lint/suspicious/noTsIgnore: Cloudflare provides this runtime-only module inside workerd.
// @ts-ignore
import { DurableObject } from "cloudflare:workers";
import {
  ContextSchema,
  CreateMemorySchema,
  createMemoryId,
  ForgetMemorySchema,
  GraphEdgeSchema,
  type MemoryRecord,
  type SearchInput,
  type SearchResult,
  SearchSchema,
  UpdateMemorySchema,
} from "@openmemory/core";
import type { RateLimitResult } from "./operational-controls";

const RATE_LIMIT_WINDOW_MS = 60_000;

type SearchWithSemanticIds = Partial<SearchInput> & {
  q: string;
  semanticIds?: string[];
};

type RateLimitInput = {
  key: string;
  limit: number;
  now: number;
};

type IngestionJobInput = {
  sourceId: string;
  input: unknown;
  metadata?: Record<string, unknown>;
};

type MemoryGraphEnv = Record<string, unknown>;
type SqlState = {
  storage: {
    sql: {
      exec<T = Record<string, unknown>>(
        query: string,
        ...bindings: unknown[]
      ): {
        toArray(): T[];
      };
    };
  };
};
type DurableObjectRuntimeState = ConstructorParameters<
  typeof DurableObject
>[0] &
  SqlState;

export class MemoryGraph extends DurableObject<MemoryGraphEnv, unknown> {
  protected declare ctx: DurableObjectRuntimeState;

  constructor(ctx: DurableObjectRuntimeState, env: MemoryGraphEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.migrate();
    });
  }

  async checkRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
    const limit = Math.max(0, input.limit);
    const key = input.key.slice(0, 512);
    this.sqlState.storage.sql.exec(
      `delete from rate_limit_buckets where reset_at <= ?`,
      input.now,
    );

    const existing = this.sqlState.storage.sql
      .exec<RateLimitBucketRow>(
        `select key, count, reset_at from rate_limit_buckets where key = ? limit 1`,
        key,
      )
      .toArray()[0];
    const count = existing ? existing.count + 1 : 1;
    const resetAt = existing?.reset_at ?? input.now + RATE_LIMIT_WINDOW_MS;

    this.sqlState.storage.sql.exec(
      `insert into rate_limit_buckets (key, count, reset_at, updated_at)
       values (?, ?, ?, ?)
       on conflict(key) do update set count = excluded.count, reset_at = excluded.reset_at, updated_at = excluded.updated_at`,
      key,
      count,
      resetAt,
      input.now,
    );

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((resetAt - input.now) / 1_000),
    );
    const remaining = Math.max(0, limit - count);

    return {
      enabled: true,
      headers: {
        "retry-after": String(count > limit ? retryAfterSeconds : 0),
        "x-ratelimit-limit": String(limit),
        "x-ratelimit-remaining": String(remaining),
        "x-ratelimit-reset": String(retryAfterSeconds),
        "x-ratelimit-scope": "global",
      },
      limit,
      limited: count > limit,
      remaining,
      retryAfterSeconds,
      scope: "global",
    };
  }

  async createIngestionJob(input: IngestionJobInput) {
    const now = new Date().toISOString();
    const job = {
      sourceId: input.sourceId,
      status: "queued" as const,
      input: input.input,
      metadata: input.metadata ?? {},
      result: undefined,
      error: undefined,
      createdAt: now,
      updatedAt: now,
      completedAt: undefined,
    };

    this.sqlState.storage.sql.exec(
      `insert into ingestion_jobs
       (source_id, status, input_json, metadata_json, result_json, error_json, created_at, updated_at, completed_at)
       values (?, ?, ?, ?, null, null, ?, ?, null)
       on conflict(source_id) do update set
         status = excluded.status,
         input_json = excluded.input_json,
         metadata_json = excluded.metadata_json,
         result_json = null,
         error_json = null,
         updated_at = excluded.updated_at,
         completed_at = null`,
      job.sourceId,
      job.status,
      JSON.stringify(job.input),
      JSON.stringify(job.metadata),
      now,
      now,
    );

    return job;
  }

  async startIngestionJob(sourceId: string) {
    const now = new Date().toISOString();
    this.sqlState.storage.sql.exec(
      `update ingestion_jobs
       set status = 'processing', updated_at = ?
       where source_id = ? and status in ('queued', 'failed')`,
      now,
      sourceId,
    );
    return this.getIngestionJob(sourceId);
  }

  async completeIngestionJob(sourceId: string, result: unknown) {
    const now = new Date().toISOString();
    this.sqlState.storage.sql.exec(
      `update ingestion_jobs
       set status = 'completed', result_json = ?, error_json = null, updated_at = ?, completed_at = ?
       where source_id = ?`,
      JSON.stringify(summarizeIngestionResult(result)),
      now,
      now,
      sourceId,
    );
    return this.getIngestionJob(sourceId);
  }

  async failIngestionJob(sourceId: string, error: unknown) {
    const now = new Date().toISOString();
    this.sqlState.storage.sql.exec(
      `update ingestion_jobs
       set status = 'failed', error_json = ?, updated_at = ?
       where source_id = ?`,
      JSON.stringify(error),
      now,
      sourceId,
    );
    return this.getIngestionJob(sourceId);
  }

  async getIngestionJob(sourceId: string) {
    const row = this.sqlState.storage.sql
      .exec<IngestionJobRow>(
        `select * from ingestion_jobs where source_id = ? limit 1`,
        sourceId,
      )
      .toArray()[0];
    return row ? rowToIngestionJob(row) : undefined;
  }

  private get sqlState(): SqlState {
    return this.ctx as unknown as SqlState;
  }

  async createMemory(input: unknown) {
    const data = CreateMemorySchema.parse(input);
    const now = new Date().toISOString();
    const memory: MemoryRecord = {
      id: createMemoryId(),
      content: data.content,
      source: data.source,
      conversationId: data.conversationId,
      tags: data.tags,
      metadata: data.metadata,
      type: data.type,
      status: "active",
      isLatest: true,
      confidence: data.confidence,
      importance: data.importance,
      validFrom: data.validFrom,
      validUntil: data.validUntil,
      entityIds: data.entityIds,
      createdAt: now,
      updatedAt: now,
    };

    this.insertMemory(memory);
    this.upsertTags(memory.id, memory.tags);
    this.upsertEntities(memory.id, memory.entityIds);

    return memory;
  }

  async updateMemory(id: string, input: unknown) {
    const current = this.getMemoryById(id);
    if (!current || current.status === "forgotten") {
      return undefined;
    }

    const data = UpdateMemorySchema.parse(input);
    const now = new Date().toISOString();
    const next: MemoryRecord = {
      ...current,
      id: createMemoryId(),
      content: data.content,
      source: data.source,
      tags: data.tags ?? current.tags,
      metadata: { ...current.metadata, ...data.metadata },
      status: "active",
      isLatest: true,
      confidence: data.confidence ?? current.confidence,
      importance: data.importance ?? current.importance,
      validFrom: data.validFrom ?? current.validFrom,
      validUntil: data.validUntil ?? current.validUntil,
      supersedesId: data.relationship === "updates" ? current.id : undefined,
      createdAt: now,
      updatedAt: now,
    };

    this.insertMemory(next);
    this.upsertTags(next.id, next.tags);
    this.upsertEntities(next.id, next.entityIds);

    if (data.relationship === "updates") {
      this.sqlState.storage.sql.exec(
        `update memories set status = 'superseded', is_latest = 0, updated_at = ? where id = ?`,
        now,
        current.id,
      );
    }

    await this.addEdge({
      sourceId: next.id,
      targetId: current.id,
      relationship: data.relationship,
      weight: data.relationship === "updates" ? 1 : 0.8,
      metadata: {
        createdBy: "updateMemory",
      },
    });

    return next;
  }

  async forgetMemory(id: string, input: unknown) {
    const data = ForgetMemorySchema.parse(input);
    const memory = this.getMemoryById(id);
    if (!memory) {
      return undefined;
    }

    const now = new Date().toISOString();
    this.sqlState.storage.sql.exec(
      `update memories
       set status = 'forgotten', is_latest = 0, forgotten_at = ?, forget_reason = ?, updated_at = ?
       where id = ?`,
      now,
      data.reason ?? null,
      now,
      id,
    );

    return this.getMemoryById(id);
  }

  async getMemory(id: string) {
    return this.getMemoryById(id);
  }

  async listMemories(limit: number, includeHistorical = false) {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const where = includeHistorical
      ? `status != 'forgotten'`
      : `status = 'active' and is_latest = 1`;
    const rows = this.sqlState.storage.sql
      .exec<MemoryRow>(
        `select * from memories where ${where} order by created_at desc limit ?`,
        safeLimit,
      )
      .toArray();

    return rows.map(rowToMemory);
  }

  async search(input: SearchWithSemanticIds) {
    const data = SearchSchema.parse(input);
    const semanticIds = Array.isArray(input.semanticIds)
      ? input.semanticIds
      : [];
    const bySemantic = semanticIds
      .map((id, index) =>
        this.getMemoryById(id, 1 - index / Math.max(semanticIds.length, 1)),
      )
      .filter((memory): memory is SearchResult => Boolean(memory));

    const keywordRows: MemoryRow[] = this.sqlState.storage.sql
      .exec<MemoryRow>(
        `select * from memories order by created_at desc limit 1000`,
      )
      .toArray();

    const queryTerms = tokenize(data.q);
    const keywordScores: Array<{ memory: MemoryRecord; score: number }> =
      keywordRows.map((row) => {
        const memory = rowToMemory(row);
        const contentTerms = new Set(tokenize(memory.content));
        const tagTerms = new Set(memory.tags.flatMap(tokenize));
        const matches = queryTerms.filter(
          (term) => contentTerms.has(term) || tagTerms.has(term),
        );
        return {
          memory,
          score:
            queryTerms.length === 0 ? 0 : matches.length / queryTerms.length,
        };
      });

    const byKeyword: SearchResult[] = keywordScores
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ memory, score }) => ({
        ...memory,
        score: score * 0.5,
        reason: "keyword",
      }));

    const now = data.now ?? new Date().toISOString();
    const seen = new Set<string>();
    const baseResults = [...bySemantic, ...byKeyword]
      .filter((memory) => {
        if (seen.has(memory.id)) {
          return false;
        }
        seen.add(memory.id);
        return (
          isVisibleForRecall(memory, {
            includeHistorical: data.includeHistorical,
            includeForgotten: data.includeForgotten,
            now,
          }) &&
          (data.tags.length === 0 ||
            data.tags.some((tag) => memory.tags.includes(tag)))
        );
      })
      .sort((a, b) => rankResult(b, now) - rankResult(a, now));

    const graphResults = this.expandGraphResults(baseResults, now, {
      includeHistorical: data.includeHistorical,
      includeForgotten: data.includeForgotten,
    });

    const bestById = new Map<string, SearchResult>();
    for (const result of [...baseResults, ...graphResults]) {
      const existing = bestById.get(result.id);
      if (!existing || rankResult(result, now) > rankResult(existing, now)) {
        bestById.set(result.id, result);
      }
    }

    return [...bestById.values()]
      .sort((a, b) => rankResult(b, now) - rankResult(a, now))
      .slice(0, data.limit);
  }

  async getProfile() {
    const rows: MemoryRecord[] = this.sqlState.storage.sql
      .exec<MemoryRow>(
        `select * from memories
         where status = 'active' and is_latest = 1
         order by importance desc, updated_at desc
         limit 200`,
      )
      .toArray()
      .map(rowToMemory);

    const stable = rows
      .filter((memory) =>
        ["fact", "preference", "decision"].includes(memory.type),
      )
      .slice(0, 12);
    const current = rows
      .filter((memory) => ["episode", "insight"].includes(memory.type))
      .slice(0, 12);

    return {
      stable,
      current,
      summary: buildProfileSummary(stable, current),
      generatedAt: new Date().toISOString(),
    };
  }

  async getContext(input: unknown) {
    const data = ContextSchema.parse(input);
    const memories = await this.search({
      q: data.q,
      limit: data.limit,
      tags: [],
      includeHistorical: data.includeHistorical,
    });
    const profile = data.includeProfile ? await this.getProfile() : undefined;

    return {
      query: data.q,
      profile,
      memories,
      context: assembleContext(profile?.summary, memories),
    };
  }

  async addEdge(input: unknown) {
    const edge = GraphEdgeSchema.parse(input);
    const now = new Date().toISOString();
    this.sqlState.storage.sql.exec(
      `insert or replace into edges
       (source_id, target_id, relationship, weight, metadata_json, created_at, updated_at)
       values (?, ?, ?, ?, ?, coalesce((select created_at from edges where source_id = ? and relationship = ? and target_id = ?), ?), ?)`,
      edge.sourceId,
      edge.targetId,
      edge.relationship,
      edge.weight,
      JSON.stringify(edge.metadata),
      edge.sourceId,
      edge.relationship,
      edge.targetId,
      now,
      now,
    );
    return { ...edge, createdAt: now, updatedAt: now };
  }

  async getNeighbors(id: string) {
    const rows = this.sqlState.storage.sql
      .exec<EdgeRow>(
        `select * from edges where source_id = ? or target_id = ? order by updated_at desc limit 100`,
        id,
        id,
      )
      .toArray();

    return rows.map(rowToEdge);
  }

  async getStats() {
    const [memoryStats] = this.sqlState.storage.sql
      .exec<{
        total_memories: number;
        active_memories: number;
        historical_memories: number;
        forgotten_memories: number;
      }>(
        `select
          count(*) as total_memories,
          sum(case when status = 'active' and is_latest = 1 then 1 else 0 end) as active_memories,
          sum(case when status != 'active' or is_latest = 0 then 1 else 0 end) as historical_memories,
          sum(case when status = 'forgotten' then 1 else 0 end) as forgotten_memories
        from memories`,
      )
      .toArray();
    const [edgeStats] = this.sqlState.storage.sql
      .exec<{ total_edges: number; relationship_count: number }>(
        `select
          count(*) as total_edges,
          count(distinct relationship) as relationship_count
        from edges`,
      )
      .toArray();
    const [entityStats] = this.sqlState.storage.sql
      .exec<{ entity_count: number }>(
        `select count(distinct entity_id) as entity_count from memory_entities`,
      )
      .toArray();
    const [tagStats] = this.sqlState.storage.sql
      .exec<{ tag_count: number }>(
        `select count(distinct tag) as tag_count from memory_tags`,
      )
      .toArray();

    return {
      totalMemories: memoryStats?.total_memories ?? 0,
      activeMemories: memoryStats?.active_memories ?? 0,
      historicalMemories: memoryStats?.historical_memories ?? 0,
      forgottenMemories: memoryStats?.forgotten_memories ?? 0,
      totalEdges: edgeStats?.total_edges ?? 0,
      relationshipCount: edgeStats?.relationship_count ?? 0,
      entityCount: entityStats?.entity_count ?? 0,
      tagCount: tagStats?.tag_count ?? 0,
      generatedAt: new Date().toISOString(),
    };
  }

  async exportGraph() {
    const memories = this.sqlState.storage.sql
      .exec<MemoryRow>(`select * from memories order by created_at asc`)
      .toArray()
      .map(rowToMemory);
    const edges = this.sqlState.storage.sql
      .exec<EdgeRow>(
        `select * from edges order by created_at asc, source_id asc, relationship asc`,
      )
      .toArray()
      .map(rowToEdge);

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      stats: await this.getStats(),
      memories,
      edges,
    };
  }

  async linkRelatedMemories(id: string) {
    const memory = this.getMemoryById(id);
    if (!memory || memory.entityIds.length === 0) {
      return [];
    }

    const rows = this.sqlState.storage.sql
      .exec<MemoryRow>(
        `select distinct m.* from memories m
         join memory_entities e on e.memory_id = m.id
         where e.entity_id in (${memory.entityIds.map(() => "?").join(",")})
           and m.id != ?
           and m.status = 'active'
           and m.is_latest = 1
         order by m.updated_at desc
         limit 12`,
        ...memory.entityIds,
        id,
      )
      .toArray();

    const edges = [];
    for (const related of rows.map(rowToMemory)) {
      const sharedEntities = memory.entityIds.filter((entityId) =>
        related.entityIds.includes(entityId),
      );
      if (sharedEntities.length === 0) {
        continue;
      }

      edges.push(
        await this.addEdge({
          sourceId: id,
          targetId: related.id,
          relationship: "shares_entity",
          weight: Math.min(1, 0.35 + sharedEntities.length * 0.15),
          metadata: {
            createdBy: "linkRelatedMemories",
            entityIds: sharedEntities,
          },
        }),
      );
    }

    return edges;
  }

  private migrate() {
    this.sqlState.storage.sql.exec(`
      create table if not exists memories (
        id text primary key,
        content text not null,
        source text not null,
        conversation_id text,
        tags_json text not null,
        metadata_json text not null,
        created_at text not null,
        updated_at text not null
      );

      create index if not exists memories_created_at_idx on memories(created_at);
      create index if not exists memories_conversation_id_idx on memories(conversation_id);

      create table if not exists edges (
        source_id text not null,
        target_id text not null,
        relationship text not null,
        weight real not null,
        metadata_json text not null,
        created_at text not null,
        updated_at text not null,
        primary key (source_id, relationship, target_id)
      );

      create index if not exists edges_source_id_idx on edges(source_id);
      create index if not exists edges_target_id_idx on edges(target_id);
    `);

    addColumn(
      this.sqlState,
      "memories",
      "type",
      "text not null default 'fact'",
    );
    addColumn(
      this.sqlState,
      "memories",
      "status",
      "text not null default 'active'",
    );
    addColumn(
      this.sqlState,
      "memories",
      "is_latest",
      "integer not null default 1",
    );
    addColumn(
      this.sqlState,
      "memories",
      "confidence",
      "real not null default 0.8",
    );
    addColumn(
      this.sqlState,
      "memories",
      "importance",
      "real not null default 0.5",
    );
    addColumn(this.sqlState, "memories", "valid_from", "text");
    addColumn(this.sqlState, "memories", "valid_until", "text");
    addColumn(this.sqlState, "memories", "supersedes_id", "text");
    addColumn(
      this.sqlState,
      "memories",
      "entity_ids_json",
      "text not null default '[]'",
    );
    addColumn(this.sqlState, "memories", "forgotten_at", "text");
    addColumn(this.sqlState, "memories", "forget_reason", "text");

    this.sqlState.storage.sql.exec(`
      create index if not exists memories_status_latest_idx on memories(status, is_latest);
      create index if not exists memories_type_idx on memories(type);
      create index if not exists memories_valid_until_idx on memories(valid_until);

      create table if not exists memory_tags (
        memory_id text not null,
        tag text not null,
        primary key (memory_id, tag)
      );

      create index if not exists memory_tags_tag_idx on memory_tags(tag);

      create table if not exists memory_entities (
        memory_id text not null,
        entity_id text not null,
        primary key (memory_id, entity_id)
      );

      create index if not exists memory_entities_entity_idx on memory_entities(entity_id);

      create table if not exists rate_limit_buckets (
        key text primary key,
        count integer not null,
        reset_at integer not null,
        updated_at integer not null
      );

      create index if not exists rate_limit_buckets_reset_idx on rate_limit_buckets(reset_at);

      create table if not exists ingestion_jobs (
        source_id text primary key,
        status text not null,
        input_json text not null,
        metadata_json text not null,
        result_json text,
        error_json text,
        created_at text not null,
        updated_at text not null,
        completed_at text
      );

      create index if not exists ingestion_jobs_status_updated_idx on ingestion_jobs(status, updated_at);
    `);
  }

  private insertMemory(memory: MemoryRecord) {
    this.sqlState.storage.sql.exec(
      `insert into memories (
        id, content, source, conversation_id, tags_json, metadata_json, type, status,
        is_latest, confidence, importance, valid_from, valid_until, supersedes_id,
        entity_ids_json, forgotten_at, forget_reason, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      memory.id,
      memory.content,
      memory.source,
      memory.conversationId ?? null,
      JSON.stringify(memory.tags),
      JSON.stringify(memory.metadata),
      memory.type,
      memory.status,
      memory.isLatest ? 1 : 0,
      memory.confidence,
      memory.importance,
      memory.validFrom ?? null,
      memory.validUntil ?? null,
      memory.supersedesId ?? null,
      JSON.stringify(memory.entityIds),
      memory.forgottenAt ?? null,
      memory.forgetReason ?? null,
      memory.createdAt,
      memory.updatedAt,
    );
  }

  private upsertTags(memoryId: string, tags: string[]) {
    this.sqlState.storage.sql.exec(
      `delete from memory_tags where memory_id = ?`,
      memoryId,
    );
    for (const tag of tags) {
      this.sqlState.storage.sql.exec(
        `insert or ignore into memory_tags (memory_id, tag) values (?, ?)`,
        memoryId,
        tag,
      );
    }
  }

  private upsertEntities(memoryId: string, entityIds: string[]) {
    this.sqlState.storage.sql.exec(
      `delete from memory_entities where memory_id = ?`,
      memoryId,
    );
    for (const entityId of entityIds) {
      this.sqlState.storage.sql.exec(
        `insert or ignore into memory_entities (memory_id, entity_id) values (?, ?)`,
        memoryId,
        entityId,
      );
    }
  }

  private getMemoryById(id: string, score = 1): SearchResult | undefined {
    const row = this.sqlState.storage.sql
      .exec<MemoryRow>(`select * from memories where id = ? limit 1`, id)
      .toArray()[0];
    if (!row) {
      return undefined;
    }
    return { ...rowToMemory(row), score, reason: "semantic" };
  }

  private expandGraphResults(
    baseResults: SearchResult[],
    now: string,
    options: {
      includeHistorical: boolean;
      includeForgotten: boolean;
    },
  ) {
    const graphResults: SearchResult[] = [];
    for (const result of baseResults.slice(0, 10)) {
      const edges = this.sqlState.storage.sql
        .exec<EdgeRow>(
          `select * from edges where source_id = ? or target_id = ? order by weight desc, updated_at desc limit 12`,
          result.id,
          result.id,
        )
        .toArray();

      for (const edge of edges) {
        const otherId =
          edge.source_id === result.id ? edge.target_id : edge.source_id;
        const neighbor = this.getMemoryById(
          otherId,
          Math.max(0.05, result.score * edge.weight * 0.65),
        );
        if (neighbor && isVisibleForRecall(neighbor, { ...options, now })) {
          graphResults.push({ ...neighbor, reason: "graph" });
        }
      }
    }

    return graphResults;
  }
}

type MemoryRow = {
  id: string;
  content: string;
  source: string;
  conversation_id: string | null;
  tags_json: string;
  metadata_json: string;
  type: string;
  status: string;
  is_latest: number;
  confidence: number;
  importance: number;
  valid_from: string | null;
  valid_until: string | null;
  supersedes_id: string | null;
  entity_ids_json: string;
  forgotten_at: string | null;
  forget_reason: string | null;
  created_at: string;
  updated_at: string;
};

type EdgeRow = {
  source_id: string;
  target_id: string;
  relationship: string;
  weight: number;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type RateLimitBucketRow = {
  key: string;
  count: number;
  reset_at: number;
};

type IngestionJobRow = {
  source_id: string;
  status: string;
  input_json: string;
  metadata_json: string;
  result_json: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function rowToMemory(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    content: row.content,
    source: row.source,
    conversationId: row.conversation_id ?? undefined,
    tags: parseJson(row.tags_json, []),
    metadata: parseJson(row.metadata_json, {}),
    type: parseMemoryType(row.type),
    status: parseMemoryStatus(row.status),
    isLatest: Boolean(row.is_latest),
    confidence: row.confidence,
    importance: row.importance,
    validFrom: row.valid_from ?? undefined,
    validUntil: row.valid_until ?? undefined,
    supersedesId: row.supersedes_id ?? undefined,
    entityIds: parseJson(row.entity_ids_json, []),
    forgottenAt: row.forgotten_at ?? undefined,
    forgetReason: row.forget_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEdge(row: EdgeRow) {
  return {
    sourceId: row.source_id,
    targetId: row.target_id,
    relationship: row.relationship,
    weight: row.weight,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToIngestionJob(row: IngestionJobRow) {
  return {
    sourceId: row.source_id,
    status: parseIngestionStatus(row.status),
    input: parseJson(row.input_json, {}),
    metadata: parseJson(row.metadata_json, {}),
    result: row.result_json ? parseJson(row.result_json, undefined) : undefined,
    error: row.error_json ? parseJson(row.error_json, undefined) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function parseIngestionStatus(value: string) {
  if (
    value === "queued" ||
    value === "processing" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }
  return "failed";
}

function summarizeIngestionResult(value: unknown) {
  if (!isRecord(value)) {
    return value;
  }

  const memories = Array.isArray(value.memories) ? value.memories : [];
  const edges = Array.isArray(value.edges) ? value.edges : [];

  return {
    sourceId: typeof value.sourceId === "string" ? value.sourceId : undefined,
    chunkCount:
      typeof value.chunkCount === "number" ? value.chunkCount : memories.length,
    memoryIds: memories
      .map((memory) =>
        isRecord(memory) && typeof memory.id === "string"
          ? memory.id
          : undefined,
      )
      .filter(Boolean),
    edgeCount: edges.length,
  };
}

function isVisibleForRecall(
  memory: MemoryRecord,
  options: {
    includeHistorical: boolean;
    includeForgotten: boolean;
    now: string;
  },
) {
  if (!options.includeForgotten && memory.status === "forgotten") {
    return false;
  }
  if (
    !options.includeHistorical &&
    (memory.status !== "active" || !memory.isLatest)
  ) {
    return false;
  }
  if (
    !options.includeHistorical &&
    memory.validUntil &&
    memory.validUntil < options.now
  ) {
    return false;
  }
  return true;
}

function buildProfileSummary(stable: MemoryRecord[], current: MemoryRecord[]) {
  const lines = [
    ...stable.map((memory) => `- ${memory.content}`),
    ...current.map((memory) => `- Current: ${memory.content}`),
  ];
  return lines.length
    ? lines.join("\n")
    : "No durable profile has been established yet.";
}

function assembleContext(
  profileSummary: string | undefined,
  memories: SearchResult[],
) {
  const sections = [];
  if (profileSummary) {
    sections.push(`Profile\n${profileSummary}`);
  }
  if (memories.length) {
    sections.push(
      `Relevant memories\n${memories
        .map(
          (memory, index) =>
            `${index + 1}. (${memory.reason}, ${memory.score.toFixed(2)}) ${memory.content}`,
        )
        .join("\n")}`,
    );
  }
  return sections.join("\n\n");
}

function rankResult(result: SearchResult, now: string) {
  return (
    result.score * 0.62 +
    reasonBoost(result.reason) +
    result.importance * 0.16 +
    result.confidence * 0.12 +
    recencyBoost(result.updatedAt, now) +
    currentnessBoost(result)
  );
}

function reasonBoost(reason: SearchResult["reason"]) {
  if (reason === "semantic") {
    return 0.08;
  }
  if (reason === "keyword") {
    return 0.05;
  }
  return 0.03;
}

function recencyBoost(updatedAt: string, now: string) {
  const ageMs = Date.parse(now) - Date.parse(updatedAt);
  if (!Number.isFinite(ageMs) || ageMs <= 0) {
    return 0.05;
  }

  const ageDays = ageMs / 86_400_000;
  return Math.max(0, 0.05 * (1 - ageDays / 30));
}

function currentnessBoost(result: SearchResult) {
  if (result.status === "active" && result.isLatest) {
    return 0.04;
  }
  if (result.status === "forgotten") {
    return -0.3;
  }
  return -0.08;
}

function parseMemoryType(value: string): MemoryRecord["type"] {
  if (
    value === "fact" ||
    value === "preference" ||
    value === "decision" ||
    value === "episode" ||
    value === "insight" ||
    value === "profile"
  ) {
    return value;
  }
  return "fact";
}

function parseMemoryStatus(value: string): MemoryRecord["status"] {
  if (
    value === "active" ||
    value === "superseded" ||
    value === "forgotten" ||
    value === "archived"
  ) {
    return value;
  }
  return "active";
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function addColumn(
  ctx: SqlState,
  table: string,
  column: string,
  definition: string,
) {
  try {
    ctx.storage.sql.exec(
      `alter table ${table} add column ${column} ${definition}`,
    );
  } catch (error) {
    if (!String(error).toLowerCase().includes("duplicate column")) {
      throw error;
    }
  }
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
