import * as z from "zod/v3";

export const MemoryMetadataSchema = z.record(z.unknown()).default({});

export const MemoryTypeSchema = z.enum([
  "fact",
  "preference",
  "decision",
  "episode",
  "insight",
  "profile",
]);

export const MemoryStatusSchema = z.enum([
  "active",
  "superseded",
  "forgotten",
  "archived",
]);

export const GraphRelationshipDefinitions = {
  updates: {
    category: "versioning",
    direction: "forward",
    label: "Updates",
    defaultWeight: 1,
    description: "A newer memory supersedes an older memory.",
  },
  extends: {
    category: "versioning",
    direction: "forward",
    label: "Extends",
    defaultWeight: 0.8,
    description: "A memory adds detail without replacing the target.",
  },
  derives: {
    category: "provenance",
    direction: "forward",
    label: "Derives",
    defaultWeight: 0.72,
    description: "A memory was inferred from or derived from the target.",
  },
  supports: {
    category: "causal",
    direction: "forward",
    label: "Supports",
    defaultWeight: 0.72,
    description: "The source strengthens or enables the target.",
  },
  blocks: {
    category: "causal",
    direction: "forward",
    label: "Blocks",
    defaultWeight: 0.72,
    description: "The source prevents or conflicts with the target.",
  },
  depends_on: {
    category: "causal",
    direction: "forward",
    label: "Depends on",
    defaultWeight: 0.72,
    description: "The source requires the target.",
  },
  replaces: {
    category: "versioning",
    direction: "forward",
    label: "Replaces",
    defaultWeight: 0.86,
    description: "The source explicitly replaces the target.",
  },
  uses: {
    category: "reference",
    direction: "forward",
    label: "Uses",
    defaultWeight: 0.68,
    description: "The source uses or calls the target.",
  },
  improves: {
    category: "causal",
    direction: "forward",
    label: "Improves",
    defaultWeight: 0.74,
    description: "The source improves or optimizes the target.",
  },
  shares_entity: {
    category: "similarity",
    direction: "bidirectional",
    label: "Shares entity",
    defaultWeight: 0.5,
    description: "Memories mention at least one shared canonical entity.",
  },
  next_chunk: {
    category: "document",
    direction: "forward",
    label: "Next chunk",
    defaultWeight: 0.82,
    description: "The target is the next chunk from the same source document.",
  },
  previous_chunk: {
    category: "document",
    direction: "reverse",
    label: "Previous chunk",
    defaultWeight: 0.82,
    description:
      "The target is the previous chunk from the same source document.",
  },
} as const;

export const GraphRelationshipSchema = z.enum(
  Object.keys(GraphRelationshipDefinitions) as [
    keyof typeof GraphRelationshipDefinitions,
    ...(keyof typeof GraphRelationshipDefinitions)[],
  ],
);

export type GraphRelationship = z.infer<typeof GraphRelationshipSchema>;
export type GraphRelationshipCategory =
  (typeof GraphRelationshipDefinitions)[GraphRelationship]["category"];

export type GraphRelationshipDefinition = {
  relationship: GraphRelationship;
  category: GraphRelationshipCategory;
  direction: "forward" | "reverse" | "bidirectional";
  label: string;
  defaultWeight: number;
  description: string;
};

export const GraphRelationshipCatalog: GraphRelationshipDefinition[] =
  Object.entries(GraphRelationshipDefinitions).map(
    ([relationship, definition]) => ({
      relationship: relationship as GraphRelationship,
      ...definition,
    }),
  );

export function normalizeGraphRelationship(value: string): GraphRelationship {
  return GraphRelationshipSchema.parse(
    value
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_"),
  );
}

export function getGraphRelationshipDefinition(
  relationship: GraphRelationship,
) {
  return GraphRelationshipDefinitions[relationship];
}

export const CreateMemorySchema = z.object({
  content: z.string().min(1).max(200_000),
  source: z.string().min(1).max(120).default("api"),
  conversationId: z.string().min(1).max(200).optional(),
  tags: z.array(z.string().min(1).max(80)).max(50).default([]),
  metadata: MemoryMetadataSchema,
  type: MemoryTypeSchema.default("fact"),
  confidence: z.number().min(0).max(1).default(0.8),
  importance: z.number().min(0).max(1).default(0.5),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  entityIds: z.array(z.string().min(1).max(160)).max(50).default([]),
});

export const SearchSchema = z.object({
  q: z.string().min(1).max(4_000),
  limit: z.number().int().min(1).max(50).default(10),
  tags: z.array(z.string().min(1).max(80)).max(50).default([]),
  includeHistorical: z.boolean().default(false),
  includeForgotten: z.boolean().default(false),
  now: z.string().datetime().optional(),
});

export const GraphEdgeSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  relationship: z
    .string()
    .min(1)
    .max(80)
    .transform((value) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_"),
    )
    .pipe(GraphRelationshipSchema),
  weight: z.number().min(0).max(1).optional(),
  metadata: MemoryMetadataSchema,
});

export const MemoryRecordSchema = z.object({
  id: z.string().min(1).max(200),
  content: z.string().min(1).max(200_000),
  source: z.string().min(1).max(120),
  conversationId: z.string().min(1).max(200).optional(),
  tags: z.array(z.string().min(1).max(80)).max(50),
  metadata: MemoryMetadataSchema,
  type: MemoryTypeSchema,
  status: MemoryStatusSchema,
  isLatest: z.boolean(),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  supersedesId: z.string().min(1).max(200).optional(),
  entityIds: z.array(z.string().min(1).max(160)).max(50),
  forgottenAt: z.string().datetime().optional(),
  forgetReason: z.string().min(1).max(500).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const GraphEdgeRecordSchema = GraphEdgeSchema.extend({
  weight: z.number().min(0).max(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const GraphExportPayloadSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  stats: z.unknown().optional(),
  memories: z.array(MemoryRecordSchema).max(10_000),
  edges: z.array(GraphEdgeRecordSchema).max(50_000),
});

export const BenchmarkMemoryFixtureSchema = z.object({
  key: z.string().min(1).max(160),
  content: z.string().min(1).max(200_000),
  query: z.string().min(1).max(4_000).optional(),
  tags: z.array(z.string().min(1).max(80)).max(50).default([]),
  type: MemoryTypeSchema.default("fact"),
  confidence: z.number().min(0).max(1).default(0.8),
  importance: z.number().min(0).max(1).default(0.5),
  metadata: MemoryMetadataSchema,
});

export const BenchmarkDistractorFixtureSchema = z.union([
  z.string().min(1).max(200_000),
  BenchmarkMemoryFixtureSchema.omit({ query: true }),
]);

export const BenchmarkCaseFixtureSchema = z.object({
  query: z.string().min(1).max(4_000),
  targetKey: z.string().min(1).max(160),
});

export const BenchmarkEdgeFixtureSchema = z.object({
  sourceKey: z.string().min(1).max(160),
  targetKey: z.string().min(1).max(160),
  relationship: GraphRelationshipSchema.default("supports"),
  weight: z.number().min(0).max(1).optional(),
  metadata: MemoryMetadataSchema,
});

export const BenchmarkFixtureSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().min(1).max(200).default("memorybench-fixture"),
  importedAt: z.string().datetime().optional(),
  memories: z.array(BenchmarkMemoryFixtureSchema).min(1).max(10_000),
  distractors: z
    .array(BenchmarkDistractorFixtureSchema)
    .max(10_000)
    .default([]),
  cases: z.array(BenchmarkCaseFixtureSchema).max(10_000).default([]),
  edges: z.array(BenchmarkEdgeFixtureSchema).max(50_000).default([]),
});

export const UpdateMemorySchema = z.object({
  content: z.string().min(1).max(200_000),
  relationship: z.enum(["updates", "extends", "derives"]).default("updates"),
  source: z.string().min(1).max(120).default("api"),
  tags: z.array(z.string().min(1).max(80)).max(50).optional(),
  metadata: MemoryMetadataSchema,
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
});

export const ForgetMemorySchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

export const ContextSchema = z.object({
  q: z.string().min(1).max(4_000),
  limit: z.number().int().min(1).max(30).default(8),
  includeProfile: z.boolean().default(true),
  includeHistorical: z.boolean().default(false),
});

export const IngestSourceSchema = z.object({
  content: z.string().min(1).max(500_000),
  source: z.string().min(1).max(120).default("document"),
  title: z.string().min(1).max(200).optional(),
  tags: z.array(z.string().min(1).max(80)).max(50).default([]),
  metadata: MemoryMetadataSchema,
  chunkSize: z.number().int().min(400).max(4_000).default(1_600),
  overlap: z.number().int().min(0).max(800).default(180),
});

export type CreateMemoryInput = z.infer<typeof CreateMemorySchema>;
export type SearchInput = z.infer<typeof SearchSchema>;
export type GraphEdgeInput = z.infer<typeof GraphEdgeSchema>;
export type UpdateMemoryInput = z.infer<typeof UpdateMemorySchema>;
export type ForgetMemoryInput = z.infer<typeof ForgetMemorySchema>;
export type ContextInput = z.infer<typeof ContextSchema>;
export type IngestSourceInput = z.infer<typeof IngestSourceSchema>;
export type MemoryType = z.infer<typeof MemoryTypeSchema>;
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

export type MemoryRecord = {
  id: string;
  content: string;
  source: string;
  conversationId?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  type: MemoryType;
  status: MemoryStatus;
  isLatest: boolean;
  confidence: number;
  importance: number;
  validFrom?: string;
  validUntil?: string;
  supersedesId?: string;
  entityIds: string[];
  forgottenAt?: string;
  forgetReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type BenchmarkFixture = z.infer<typeof BenchmarkFixtureSchema>;

export type BenchmarkImportResult = {
  graphExport: z.infer<typeof GraphExportPayloadSchema>;
  cases: Array<{
    query: string;
    targetKey: string;
    targetId: string;
  }>;
};

export function importBenchmarkFixture(
  input: unknown,
  options: { importedAt?: string } = {},
): BenchmarkImportResult {
  const fixture = BenchmarkFixtureSchema.parse(input);
  const importedAt =
    options.importedAt ?? fixture.importedAt ?? new Date().toISOString();
  const memoryKeyToId = new Map<string, string>();
  const memoryIds = new Set<string>();
  const memories = fixture.memories.map((memory) => {
    const id = benchmarkMemoryId(memory.key);
    registerBenchmarkMemoryKey(memoryKeyToId, memoryIds, memory.key, id);
    return benchmarkMemoryRecord(memory, id, importedAt, {
      benchmarkName: fixture.name,
      benchmarkKey: memory.key,
      benchmarkRole: "target",
      benchmarkQuery: memory.query,
    });
  });

  for (let index = 0; index < fixture.distractors.length; index += 1) {
    const distractor = normalizeBenchmarkDistractor(
      fixture.distractors[index],
      index,
    );
    const id = benchmarkMemoryId(distractor.key);
    registerBenchmarkMemoryKey(memoryKeyToId, memoryIds, distractor.key, id);
    memories.push(
      benchmarkMemoryRecord(distractor, id, importedAt, {
        benchmarkName: fixture.name,
        benchmarkKey: distractor.key,
        benchmarkRole: "distractor",
      }),
    );
  }

  const cases = fixture.cases.map((benchmarkCase) => {
    const targetId = memoryKeyToId.get(benchmarkCase.targetKey);
    if (!targetId) {
      throw new Error(
        `Benchmark case references unknown targetKey: ${benchmarkCase.targetKey}`,
      );
    }
    return {
      query: benchmarkCase.query,
      targetKey: benchmarkCase.targetKey,
      targetId,
    };
  });

  const edges = fixture.edges.map((edge) => {
    const sourceId = memoryKeyToId.get(edge.sourceKey);
    const targetId = memoryKeyToId.get(edge.targetKey);
    if (!sourceId || !targetId) {
      throw new Error(
        `Benchmark edge references unknown keys: ${edge.sourceKey} -> ${edge.targetKey}`,
      );
    }
    const definition = getGraphRelationshipDefinition(edge.relationship);
    return {
      sourceId,
      targetId,
      relationship: edge.relationship,
      weight: edge.weight ?? definition.defaultWeight,
      metadata: edge.metadata,
      createdAt: importedAt,
      updatedAt: importedAt,
    };
  });

  const graphExport = GraphExportPayloadSchema.parse({
    version: 1,
    exportedAt: importedAt,
    stats: {
      source: "benchmark-fixture",
      name: fixture.name,
      targetCount: fixture.memories.length,
      distractorCount: fixture.distractors.length,
      caseCount: cases.length,
      edgeCount: edges.length,
      cases,
    },
    memories,
    edges,
  });

  return { graphExport, cases };
}

function benchmarkMemoryRecord(
  memory: z.infer<typeof BenchmarkMemoryFixtureSchema>,
  id: string,
  importedAt: string,
  metadata: Record<string, unknown>,
) {
  return {
    id,
    content: memory.content,
    source: "memorybench",
    tags: memory.tags,
    metadata: {
      ...memory.metadata,
      ...metadata,
    },
    type: memory.type,
    status: "active" as const,
    isLatest: true,
    confidence: memory.confidence,
    importance: memory.importance,
    entityIds: [],
    createdAt: importedAt,
    updatedAt: importedAt,
  };
}

function normalizeBenchmarkDistractor(
  distractor: z.infer<typeof BenchmarkDistractorFixtureSchema>,
  index: number,
): z.infer<typeof BenchmarkMemoryFixtureSchema> {
  if (typeof distractor === "string") {
    return BenchmarkMemoryFixtureSchema.parse({
      key: `distractor-${index + 1}`,
      content: distractor,
      tags: ["distractor"],
      type: "fact",
      metadata: {},
    });
  }
  return BenchmarkMemoryFixtureSchema.parse({
    ...distractor,
    query: undefined,
  });
}

function benchmarkMemoryId(key: string) {
  return `mem_benchmark_${slugifyBenchmarkKey(key)}`;
}

function registerBenchmarkMemoryKey(
  keyToId: Map<string, string>,
  ids: Set<string>,
  key: string,
  id: string,
) {
  if (keyToId.has(key)) {
    throw new Error(`Duplicate benchmark memory key: ${key}`);
  }
  if (ids.has(id)) {
    throw new Error(`Benchmark memory keys produce duplicate ids: ${key}`);
  }
  keyToId.set(key, id);
  ids.add(id);
}

function slugifyBenchmarkKey(key: string) {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);
}

export type GraphExportPayload = z.infer<typeof GraphExportPayloadSchema>;

export type SearchResult = MemoryRecord & {
  score: number;
  reason: "semantic" | "keyword" | "graph";
};

export const createMemoryId = () => `mem_${crypto.randomUUID()}`;
export const createSourceId = () => `src_${crypto.randomUUID()}`;

export const normalizeTenantId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 120);
