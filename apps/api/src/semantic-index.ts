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

export async function indexMemory(env: Env, tenantId: string, memory: unknown) {
  if (!isMemoryForIndex(memory)) {
    return {
      attempted: false,
      indexed: false,
      error: "invalid_memory_shape",
    } satisfies SemanticIndexResult;
  }

  const vectorId = semanticVectorId(tenantId, memory.id);
  try {
    if (!env.AI || !env.MEMORY_VECTORS) {
      return {
        attempted: false,
        indexed: false,
        vectorId,
        error: "semantic_bindings_unavailable",
      } satisfies SemanticIndexResult;
    }

    const embedding = await embed(env, memory.content);
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
          tenantId,
          memoryId: memory.id,
          source: memory.source,
          status: memory.status,
          isLatest: memory.isLatest,
        },
      },
    ]);
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
) {
  try {
    if (!env.AI || !env.MEMORY_VECTORS) {
      return [];
    }

    const embedding = await embed(env, q);
    if (!embedding) {
      return [];
    }

    const matches = await env.MEMORY_VECTORS.query(embedding, {
      topK: Math.min(limit * 3, 50),
      filter: { tenantId, status: "active", isLatest: true },
      returnMetadata: true,
    });

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
      .map((memoryId) => semanticVectorId(tenantId, memoryId));
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
    const [existingExpectedVectors, existingStaleVectors] = await Promise.all([
      getVectorsByMemoryIds(env, tenantId, expectedSample),
      getVectorsByMemoryIds(env, tenantId, staleSample),
    ]);
    const expectedVectorIds = new Set(
      existingExpectedVectors.map((vector) => vector.id),
    );
    const staleVectorIds = existingStaleVectors.map(
      (vector) =>
        semanticMemoryIdFromVectorId(tenantId, vector.id) ?? vector.id,
    );
    const missingVectorSample = expectedSample.filter(
      (memoryId) =>
        !expectedVectorIds.has(semanticVectorId(tenantId, memoryId)),
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
) {
  if (!env.MEMORY_VECTORS || memoryIds.length === 0) {
    return [];
  }

  const vectors = [];
  for (let index = 0; index < memoryIds.length; index += 100) {
    const ids = memoryIds
      .slice(index, index + 100)
      .map((memoryId) => semanticVectorId(tenantId, memoryId));
    vectors.push(...(await env.MEMORY_VECTORS.getByIds(ids)));
  }

  return vectors;
}

export function semanticVectorId(tenantId: string, memoryId: string) {
  return `t_${hashTenantId(tenantId)}:${memoryId}`;
}

function semanticMemoryIdFromVectorId(tenantId: string, vectorId: string) {
  const prefix = `t_${hashTenantId(tenantId)}:`;
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
