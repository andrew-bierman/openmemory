import { describe, expect, test, vi } from "vitest";
import type { Env } from "../src/env";
import {
  embed,
  indexMemory,
  isMemoryForIndex,
  semanticSearch,
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

  test("upserts Vectorize records with tenant-scoped ids and recall metadata", async () => {
    const vectorUpsert = vi.fn(async () => {});
    const env = fakeEnv({ vectorUpsert });

    await indexMemory(env, "tenant-a", {
      id: "mem_1",
      content: "Graph memory uses Vectorize.",
      source: "api",
      tags: ["graph"],
      status: "active",
      isLatest: true,
    });

    expect(vectorUpsert).toHaveBeenCalledWith([
      {
        id: "tenant-a:mem_1",
        values: [0.1, 0.2, 0.3],
        metadata: {
          tenantId: "tenant-a",
          memoryId: "mem_1",
          source: "api",
          tags: ["graph"],
          status: "active",
          isLatest: true,
        },
      },
    ]);
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
    ).resolves.toBeUndefined();
    expect(isMemoryForIndex({ id: "mem_1" })).toBe(false);
  });
});

function fakeEnv({
  aiRun = vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]] })),
  vectorQuery = vi.fn(async () => ({ matches: [] })),
  vectorUpsert = vi.fn(async () => {}),
}: {
  aiRun?: ReturnType<typeof vi.fn>;
  vectorQuery?: ReturnType<typeof vi.fn>;
  vectorUpsert?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    EMBEDDING_MODEL: "@cf/test/embedding",
    AI: {
      run: aiRun,
    },
    MEMORY_VECTORS: {
      query: vectorQuery,
      upsert: vectorUpsert,
    },
  } as unknown as Env;
}
