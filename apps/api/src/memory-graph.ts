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

type SearchWithSemanticIds = Partial<SearchInput> & {
  q: string;
  semanticIds?: string[];
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
    return [...bySemantic, ...byKeyword]
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
      .sort(
        (a, b) => b.score + b.importance * 0.2 - (a.score + a.importance * 0.2),
      )
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
