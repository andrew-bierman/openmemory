import { describe, expect, test, vi } from "vitest";
import type { Env } from "../src/env";
import {
  getSemanticIndexDiagnostic,
  indexMemory,
  semanticSearch,
  semanticTenantPartition,
  semanticVectorId,
} from "../src/semantic-index";

function memory(content: string) {
  return {
    id: "mem_ad20b24d-1ac1-4caa-8a5a-c5a062bf91f7",
    content,
    source: "test",
    tags: [],
    status: "active",
    isLatest: true,
  };
}
function barrier() {
  let arrive!: () => void;
  let resume!: () => void;
  const reached = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const released = new Promise<void>((resolve) => {
    resume = resolve;
  });
  return {
    reached,
    resume,
    async pause() {
      arrive();
      await released;
    },
  };
}

describe("semantic generation partitions", () => {
  test("preserves legacy ids and bounds generation-qualified ids", () => {
    const id = memory("x").id;
    expect(semanticTenantPartition("tenant-a", 0)).toBe("tenant-a");
    expect(semanticVectorId("tenant-a", id, 0)).toBe(
      semanticVectorId("tenant-a", id),
    );
    expect(semanticVectorId("tenant-a", id, 1)).not.toBe(
      semanticVectorId("tenant-a", id, 0),
    );
    expect(semanticVectorId("tenant-a", id, 2)).not.toBe(
      semanticVectorId("tenant-a", id, 1),
    );
    expect(
      new TextEncoder().encode(
        semanticVectorId("tenant-a", id, Number.MAX_SAFE_INTEGER),
      ).length,
    ).toBeLessThanOrEqual(64);
  });

  test.each([
    false,
    true,
  ])("late old upsert cannot overwrite/delete restored vector (cleanup failure=%s)", async (cleanupFails) => {
    const gate = barrier();
    let generation = 0;
    let canonical = memory("old content");
    type Vector = {
      id: string;
      values: number[];
      metadata: { tenantId: string; generation: number; memoryId: string };
    };
    const vectors = new Map<string, Vector>();
    const embed = vi.fn(async (_model: string, input: { text: string }) => ({
      data: [[input.text === "old content" ? 1 : 2]],
    }));
    const query = vi.fn(
      async (
        _embedding: number[],
        options: { filter: { tenantId: string } },
      ) => ({
        matches: [...vectors.values()].filter(
          (row) => row.metadata.tenantId === options.filter.tenantId,
        ),
      }),
    );
    const deleteByIds = vi.fn(async (ids: string[]) => {
      if (cleanupFails) throw new Error("temporary provider failure");
      for (const id of ids) vectors.delete(id);
    });
    const env = {
      EMBEDDING_MODEL: "@cf/test",
      MEMORY_GRAPHS: {
        idFromName: (id: string) => id,
        get: () => ({
          getIngestionGeneration: async () => generation,
          getMemory: async () => canonical,
        }),
      },
      AI: { run: embed },
      MEMORY_VECTORS: {
        upsert: async (rows: Vector[]) => {
          if (rows[0]?.metadata.generation === 0) await gate.pause();
          for (const row of rows) vectors.set(row.id, row);
        },
        deleteByIds,
        query,
        getByIds: async (ids: string[]) =>
          ids.flatMap((id) => (vectors.has(id) ? [vectors.get(id)] : [])),
      },
    } as unknown as Env;
    const old = indexMemory(env, "tenant-a", canonical, 0);
    await gate.reached;
    generation = 1;
    canonical = memory("restored fresh content");
    await expect(
      indexMemory(env, "tenant-a", canonical, 1),
    ).resolves.toMatchObject({ indexed: true });
    gate.resume();
    await expect(old).resolves.toMatchObject({
      indexed: false,
      error: "stale_memory_generation",
    });
    const freshId = semanticVectorId("tenant-a", canonical.id, 1);
    expect(vectors.get(freshId)?.values).toEqual([2]);
    expect(deleteByIds).toHaveBeenCalledWith([
      semanticVectorId("tenant-a", canonical.id, 0),
    ]);
    await expect(semanticSearch(env, "tenant-a", "query", 10)).resolves.toEqual(
      [canonical.id],
    );
    expect(query).toHaveBeenLastCalledWith(
      [2],
      expect.objectContaining({
        filter: {
          tenantId: semanticTenantPartition("tenant-a", 1),
          status: "active",
          isLatest: true,
        },
      }),
    );
    await expect(
      getSemanticIndexDiagnostic(env, "tenant-a", {
        indexableMemories: 1,
        purgeableMemories: 0,
        indexableMemoryIds: [canonical.id],
        purgeableMemoryIds: [],
      }),
    ).resolves.toMatchObject({ status: "current", missingVectorSample: [] });
    expect(vectors.size).toBe(cleanupFails ? 2 : 1);
  });

  test("default indexing rehydrates current content instead of indexing a pre-purge snapshot", async () => {
    const run = vi.fn(async () => ({ data: [[2]] }));
    const upsert = vi.fn(async () => {});
    const env = {
      EMBEDDING_MODEL: "@cf/test",
      MEMORY_GRAPHS: {
        idFromName: (id: string) => id,
        get: () => ({
          getIngestionGeneration: async () => 2,
          getMemory: async () => memory("current restored content"),
        }),
      },
      AI: { run },
      MEMORY_VECTORS: { upsert },
    } as unknown as Env;
    await expect(
      indexMemory(env, "tenant-a", memory("stale snapshot")),
    ).resolves.toMatchObject({
      indexed: true,
      vectorId: semanticVectorId("tenant-a", memory("").id, 2),
    });
    expect(run).toHaveBeenCalledWith("@cf/test", {
      text: "current restored content",
    });
    expect(upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        metadata: expect.objectContaining({
          tenantId: semanticTenantPartition("tenant-a", 2),
          generation: 2,
        }),
      }),
    ]);
  });
});
