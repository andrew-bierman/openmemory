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
