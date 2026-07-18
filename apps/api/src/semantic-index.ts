import type { Env } from "./env";

export async function indexMemory(env: Env, tenantId: string, memory: unknown) {
  if (!isMemoryForIndex(memory)) {
    return;
  }

  try {
    if (!env.AI || !env.MEMORY_VECTORS) {
      return;
    }

    const embedding = await embed(env, memory.content);
    if (!embedding) {
      return;
    }

    await env.MEMORY_VECTORS.upsert([
      {
        id: `${tenantId}:${memory.id}`,
        values: embedding,
        metadata: {
          tenantId,
          memoryId: memory.id,
          source: memory.source,
          tags: memory.tags,
          status: memory.status,
          isLatest: memory.isLatest,
        },
      },
    ]);
  } catch {
    // Local Wrangler cannot emulate AI/Vectorize bindings. The graph write is canonical.
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
      .map((memoryId) => `${tenantId}:${memoryId}`);
    try {
      const result = await env.MEMORY_VECTORS.deleteByIds(ids);
      deleted += result.count;
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
