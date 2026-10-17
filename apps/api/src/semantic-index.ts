import type { Env } from "./env";

type IndexInventory = {
  indexableMemories: number;
  purgeableMemories: number;
  indexableMemoryIds: string[];
  purgeableMemoryIds: string[];
};

export type SemanticIndexResult = {
  attempted: boolean;
  indexed: boolean;
  vectorId?: string;
  error?: string;
};

export type SemanticIndexDiagnostic = {
  configured: boolean;
  workersAiConfigured: boolean;
  vectorizeConfigured: boolean;
  expectedVectors: number;
  staleVectorCandidates: number;
  checkedVectorSample: number;
  missingVectorSample: string[];
  staleVectorSample: string[];
  repairRecommended: boolean;
  status: "current" | "needs_repair" | "unchecked" | "unconfigured";
};

export async function indexMemory(
  env: Env,
  tenantId: string,
  memory: unknown,
  expectedGeneration?: number,
) {
  if (!isMemoryForIndex(memory)) {
    return {
      attempted: false,
      indexed: false,
      error: "invalid_memory_shape",
    } satisfies SemanticIndexResult;
  }
  let generation = expectedGeneration ?? 0;
  let vectorId = semanticVectorId(tenantId, memory.id, generation);
  try {
    if (!env.AI || !env.MEMORY_VECTORS) {
      return {
        attempted: false,
        indexed: false,
        vectorId,
        error: "semantic_bindings_unavailable",
      } satisfies SemanticIndexResult;
    }
    const graph = env.MEMORY_GRAPHS.get(env.MEMORY_GRAPHS.idFromName(tenantId));
    generation = expectedGeneration ?? (await graph.getIngestionGeneration());
    vectorId = semanticVectorId(tenantId, memory.id, generation);
    const canonical = await graph.getMemory(memory.id);
    if (
      canonical?.status !== "active" ||
      !canonical.isLatest ||
      (await graph.getIngestionGeneration()) !== generation
    ) {
      return {
        attempted: false,
        indexed: false,
        vectorId,
        error: "stale_memory_generation",
      } satisfies SemanticIndexResult;
    }
    const embedding = await embed(env, canonical.content);
    if (!embedding) {
      return {
        attempted: true,
        indexed: false,
        vectorId,
        error: "embedding_unavailable",
      } satisfies SemanticIndexResult;
    }
    await env.MEMORY_VECTORS.upsert([
      {
        id: vectorId,
        values: embedding,
        metadata: {
          // tenantId is the indexed partition key. Generation zero preserves legacy vectors.
          tenantId: semanticTenantPartition(tenantId, generation),
          generation,
          memoryId: canonical.id,
          source: canonical.source,
          status: canonical.status,
          isLatest: canonical.isLatest,
        },
      },
    ]);
    if ((await graph.getIngestionGeneration()) !== generation) {
      await deleteTenantVectors(env, tenantId, [canonical.id], generation);
      return {
        attempted: true,
        indexed: false,
        vectorId,
        error: "stale_memory_generation",
      } satisfies SemanticIndexResult;
    }
    return {
      attempted: true,
      indexed: true,
      vectorId,
    } satisfies SemanticIndexResult;
  } catch {
    return {
      attempted: true,
      indexed: false,
      vectorId,
      error: "semantic_index_failed",
    } satisfies SemanticIndexResult;
  }
}

export async function semanticSearch(
  env: Env,
  tenantId: string,
  q: string,
  limit: number,
  expectedGeneration?: number,
) {
  try {
    if (!env.AI || !env.MEMORY_VECTORS) {
      return [];
    }

    const graph = env.MEMORY_GRAPHS.get(env.MEMORY_GRAPHS.idFromName(tenantId));
    const generation =
      expectedGeneration ?? (await graph.getIngestionGeneration());
    const embedding = await embed(env, q);
    if (!embedding) {
      return [];
    }

    const matches = await env.MEMORY_VECTORS.query(embedding, {
      topK: Math.min(limit * 3, 50),
      filter: {
        tenantId: semanticTenantPartition(tenantId, generation),
        status: "active",
        isLatest: true,
      },
      returnMetadata: true,
    });

    if ((await graph.getIngestionGeneration()) !== generation) return [];
    return matches.matches
      .map((match) => match.metadata?.memoryId)
      .filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export async function deleteTenantVectors(
  env: Env,
  tenantId: string,
  memoryIds: string[],
  generation = 0,
) {
  if (!env.MEMORY_VECTORS || memoryIds.length === 0) {
    return {
      attempted: memoryIds.length,
      deleted: 0,
      vectorizeConfigured: Boolean(env.MEMORY_VECTORS),
    };
  }

  let deleted = 0;
  for (let index = 0; index < memoryIds.length; index += 100) {
    const ids = memoryIds
      .slice(index, index + 100)
      .map((memoryId) => semanticVectorId(tenantId, memoryId, generation));
    try {
      const result = await env.MEMORY_VECTORS.deleteByIds(ids);
      deleted += deleteCount(result, ids.length);
    } catch {
      // Vectorize is an eventually consistent index. Canonical graph deletion already succeeded.
    }
  }

  return {
    attempted: memoryIds.length,
    deleted,
    vectorizeConfigured: true,
  };
}

function deleteCount(result: unknown, fallback: number) {
  return typeof result === "object" &&
    result !== null &&
    "count" in result &&
    typeof result.count === "number"
    ? result.count
    : fallback;
}

export async function getSemanticIndexDiagnostic(
  env: Env,
  tenantId: string,
  inventory: IndexInventory,
): Promise<SemanticIndexDiagnostic> {
  const configured = Boolean(env.AI && env.MEMORY_VECTORS);
  const base = {
    configured,
    workersAiConfigured: Boolean(env.AI),
    vectorizeConfigured: Boolean(env.MEMORY_VECTORS),
    expectedVectors: inventory.indexableMemories,
    staleVectorCandidates: inventory.purgeableMemories,
  };

  if (!configured) {
    return {
      ...base,
      checkedVectorSample: 0,
      missingVectorSample: [],
      staleVectorSample: [],
      repairRecommended: inventory.indexableMemories > 0,
      status: "unconfigured",
    };
  }

  const expectedSample = inventory.indexableMemoryIds.slice(0, 25);
  const staleSample = inventory.purgeableMemoryIds.slice(0, 25);

  try {
    const graph = env.MEMORY_GRAPHS.get(env.MEMORY_GRAPHS.idFromName(tenantId));
    const generation = await graph.getIngestionGeneration();
    const [existingExpectedVectors, existingStaleVectors] = await Promise.all([
      getVectorsByMemoryIds(env, tenantId, expectedSample, generation),
      getVectorsByMemoryIds(env, tenantId, staleSample, generation),
    ]);
    const expectedVectorIds = new Set(
      existingExpectedVectors.map((vector) => vector.id),
    );
    const staleVectorIds = existingStaleVectors.map(
      (vector) =>
        semanticMemoryIdFromVectorId(tenantId, vector.id, generation) ??
        vector.id,
    );
    const missingVectorSample = expectedSample.filter(
      (memoryId) =>
        !expectedVectorIds.has(
          semanticVectorId(tenantId, memoryId, generation),
        ),
    );
    const repairRecommended =
      missingVectorSample.length > 0 || staleVectorIds.length > 0;

    return {
      ...base,
      checkedVectorSample: expectedSample.length,
      missingVectorSample,
      staleVectorSample: staleVectorIds,
      repairRecommended,
      status: repairRecommended ? "needs_repair" : "current",
    };
  } catch {
    return {
      ...base,
      checkedVectorSample: 0,
      missingVectorSample: [],
      staleVectorSample: [],
      repairRecommended: inventory.purgeableMemories > 0,
      status: "unchecked",
    };
  }
}

async function getVectorsByMemoryIds(
  env: Env,
  tenantId: string,
  memoryIds: string[],
  generation = 0,
) {
  if (!env.MEMORY_VECTORS || memoryIds.length === 0) {
    return [];
  }

  const vectors = [];
  for (let index = 0; index < memoryIds.length; index += 100) {
    const ids = memoryIds
      .slice(index, index + 100)
      .map((memoryId) => semanticVectorId(tenantId, memoryId, generation));
    vectors.push(...(await env.MEMORY_VECTORS.getByIds(ids)));
  }

  return vectors;
}

// Reuse the existing tenantId metadata index; no new remote metadata index is required.
export function semanticTenantPartition(tenantId: string, generation = 0) {
  return generation === 0 ? tenantId : JSON.stringify([tenantId, generation]);
}

export function semanticVectorId(
  tenantId: string,
  memoryId: string,
  generation = 0,
) {
  return `t_${hashTenantId(semanticTenantPartition(tenantId, generation))}:${memoryId}`;
}

function semanticMemoryIdFromVectorId(
  tenantId: string,
  vectorId: string,
  generation = 0,
) {
  const prefix = `t_${hashTenantId(semanticTenantPartition(tenantId, generation))}:`;
  return vectorId.startsWith(prefix)
    ? vectorId.slice(prefix.length)
    : undefined;
}

function hashTenantId(tenantId: string) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < tenantId.length; index += 1) {
    hash ^= BigInt(tenantId.charCodeAt(index));
    hash *= 0x100000001b3n;
    hash &= 0xffffffffffffffffn;
  }

  return hash.toString(16).padStart(16, "0");
}

export async function embed(env: Env, text: string) {
  const response = await env.AI?.run(env.EMBEDDING_MODEL, { text });
  const data = response as { data?: number[][] };
  return data.data?.[0];
}

export function isMemoryForIndex(value: unknown): value is {
  id: string;
  content: string;
  source: string;
  tags: string[];
  status: string;
  isLatest: boolean;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "content" in value &&
    "source" in value &&
    "tags" in value
  );
}
