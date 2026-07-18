import { describe, expect, test, vi } from "vitest";
import type { Env } from "../src/env";
import {
  deleteTenantVectors,
  embed,
  getSemanticIndexDiagnostic,
  indexMemory,
  isMemoryForIndex,
  semanticSearch,
  semanticVectorId,
} from "../src/semantic-index";

describe("semantic index provider contracts", () => {
  test("embeds text through the configured Workers AI model", async () => {
    const aiRun = vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]] }));
    const env = fakeEnv({ aiRun });

    await expect(embed(env, "Graph Indexing")).resolves.toEqual([
      0.1, 0.2, 0.3,
    ]);
    expect(aiRun).toHaveBeenCalledWith("@cf/test/embedding", {
      text: "Graph Indexing",
    });
  });

  test("builds Vectorize ids under Cloudflare's hosted limit", () => {
    const vectorId = semanticVectorId(
      "2wb0oyknll738tgsbraljldthgylwprb",
      "mem_ad20b24d-1ac1-4caa-8a5a-c5a062bf91f7",
    );

    expect(vectorId).toMatch(
      /^t_[\da-f]{16}:mem_[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/,
    );
    expect(new TextEncoder().encode(vectorId).length).toBeLessThanOrEqual(64);
  });

  test("upserts Vectorize records with tenant-scoped ids and scalar recall metadata", async () => {
    const vectorUpsert = vi.fn(async () => {});
    const env = fakeEnv({ vectorUpsert });

    await expect(
      indexMemory(env, "tenant-a", {
        id: "mem_1",
        content: "Graph memory uses Vectorize.",
        source: "api",
        tags: ["graph"],
        status: "active",
        isLatest: true,
      }),
    ).resolves.toMatchObject({
      attempted: true,
      indexed: true,
      vectorId: semanticVectorId("tenant-a", "mem_1"),
    });

    expect(vectorUpsert).toHaveBeenCalledWith([
      {
        id: semanticVectorId("tenant-a", "mem_1"),
        values: [0.1, 0.2, 0.3],
        metadata: {
          tenantId: "tenant-a",
          memoryId: "mem_1",
          source: "api",
          status: "active",
          isLatest: true,
        },
      },
    ]);
  });

  test("returns bounded semantic index errors without throwing graph writes", async () => {
    const vectorUpsert = vi.fn(async () => {
      throw new Error("provider included private diagnostics");
    });
    const env = fakeEnv({ vectorUpsert });

    await expect(
      indexMemory(env, "tenant-a", {
        id: "mem_1",
        content: "Graph memory uses Vectorize.",
        source: "api",
        tags: ["graph"],
        status: "active",
        isLatest: true,
      }),
    ).resolves.toEqual({
      attempted: true,
      indexed: false,
      vectorId: semanticVectorId("tenant-a", "mem_1"),
      error: "semantic_index_failed",
    });
  });

  test("reports no-op index results when semantic bindings are unavailable", async () => {
    const env = { EMBEDDING_MODEL: "@cf/test/embedding" } as Env;

    await expect(
      indexMemory(env, "tenant-a", {
        id: "mem_1",
        content: "Graph memory uses Vectorize.",
        source: "api",
        tags: ["graph"],
        status: "active",
        isLatest: true,
      }),
    ).resolves.toEqual({
      attempted: false,
      indexed: false,
      vectorId: semanticVectorId("tenant-a", "mem_1"),
      error: "semantic_bindings_unavailable",
    });
  });

  test("normalizes Vectorize delete result shapes", async () => {
    const vectorDeleteByIds = vi.fn(async () => undefined);
    const env = fakeEnv({ vectorDeleteByIds });

    await expect(
      deleteTenantVectors(env, "tenant-a", ["mem_1", "mem_2"]),
    ).resolves.toEqual({
      attempted: 2,
      deleted: 2,
      vectorizeConfigured: true,
    });
    expect(vectorDeleteByIds).toHaveBeenCalledWith([
      semanticVectorId("tenant-a", "mem_1"),
      semanticVectorId("tenant-a", "mem_2"),
    ]);
  });

  test("uses Vectorize delete count when provided", async () => {
    const vectorDeleteByIds = vi.fn(async () => ({ count: 1 }));
    const env = fakeEnv({ vectorDeleteByIds });

    await expect(
      deleteTenantVectors(env, "tenant-a", ["mem_1", "mem_2"]),
    ).resolves.toMatchObject({
      attempted: 2,
      deleted: 1,
    });
  });

  test("queries Vectorize with active latest tenant filter and returns memory ids", async () => {
    const vectorQuery = vi.fn(async () => ({
      matches: [
        { metadata: { memoryId: "mem_a" } },
        { metadata: { memoryId: "mem_b" } },
        { metadata: { ignored: true } },
      ],
    }));
    const env = fakeEnv({ vectorQuery });

    await expect(
      semanticSearch(env, "tenant-a", "graph recall", 20),
    ).resolves.toEqual(["mem_a", "mem_b"]);
    expect(vectorQuery).toHaveBeenCalledWith([0.1, 0.2, 0.3], {
      topK: 50,
      filter: { tenantId: "tenant-a", status: "active", isLatest: true },
      returnMetadata: true,
    });
  });

  test("falls back cleanly when bindings are absent or memory shape is invalid", async () => {
    const env = { EMBEDDING_MODEL: "@cf/test/embedding" } as Env;

    await expect(semanticSearch(env, "tenant-a", "query", 5)).resolves.toEqual(
      [],
    );
    await expect(
      indexMemory(env, "tenant-a", { id: "mem_1" }),
    ).resolves.toEqual({
      attempted: false,
      indexed: false,
      error: "invalid_memory_shape",
    });
    expect(isMemoryForIndex({ id: "mem_1" })).toBe(false);
  });

  test("diagnoses missing and stale vector samples from graph inventory", async () => {
    const vectorGetByIds = vi.fn(async (ids: string[]) =>
      ids.includes(semanticVectorId("tenant-a", "mem_old"))
        ? [{ id: semanticVectorId("tenant-a", "mem_old"), values: [0.1] }]
        : [{ id: semanticVectorId("tenant-a", "mem_current"), values: [0.2] }],
    );
    const env = fakeEnv({ vectorGetByIds });

    await expect(
      getSemanticIndexDiagnostic(env, "tenant-a", {
        indexableMemories: 2,
        purgeableMemories: 1,
        indexableMemoryIds: ["mem_current", "mem_missing"],
        purgeableMemoryIds: ["mem_old"],
      }),
    ).resolves.toEqual({
      checkedVectorSample: 2,
      configured: true,
      expectedVectors: 2,
      missingVectorSample: ["mem_missing"],
      repairRecommended: true,
      staleVectorCandidates: 1,
      staleVectorSample: ["mem_old"],
      status: "needs_repair",
      vectorizeConfigured: true,
      workersAiConfigured: true,
    });
    expect(vectorGetByIds).toHaveBeenCalledWith([
      semanticVectorId("tenant-a", "mem_current"),
      semanticVectorId("tenant-a", "mem_missing"),
    ]);
    expect(vectorGetByIds).toHaveBeenCalledWith([
      semanticVectorId("tenant-a", "mem_old"),
    ]);
  });
});

function fakeEnv({
  aiRun = vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]] })),
  vectorDeleteByIds = vi.fn(async () => ({ count: 0 })),
  vectorQuery = vi.fn(async () => ({ matches: [] })),
  vectorGetByIds = vi.fn(async () => []),
  vectorUpsert = vi.fn(async () => {}),
}: {
  aiRun?: ReturnType<typeof vi.fn>;
  vectorDeleteByIds?: ReturnType<typeof vi.fn>;
  vectorGetByIds?: ReturnType<typeof vi.fn>;
  vectorQuery?: ReturnType<typeof vi.fn>;
  vectorUpsert?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    EMBEDDING_MODEL: "@cf/test/embedding",
    AI: {
      run: aiRun,
    },
    MEMORY_VECTORS: {
      deleteByIds: vectorDeleteByIds,
      getByIds: vectorGetByIds,
      query: vectorQuery,
      upsert: vectorUpsert,
    },
  } as unknown as Env;
}
