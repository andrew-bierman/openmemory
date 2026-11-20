import { describe, expect, test, vi } from "vitest";
import type { Env } from "../src/env";
import { processMemoryExtractionMessage } from "../src/extraction-worker";
import type { IngestionQueueMessage } from "../src/source-ingestion";
import { processSourceIngestionMessage } from "../src/source-ingestion";

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

function message(
  kind: "source" | "conversation",
  generation = 0,
): IngestionQueueMessage {
  const common = {
    version: 1 as const,
    sourceId: "same-source",
    tenantId: "tenant-a",
    generation,
    requestedAt: "2026-10-17T00:00:00Z",
  };
  const input = {
    source: "test",
    tags: [],
    metadata: {},
    chunkSize: 1000,
    overlap: 0,
  };
  return kind === "source"
    ? {
        ...common,
        kind,
        input: { ...input, content: "Private content for ingestion." },
      }
    : {
        ...common,
        kind,
        input: {
          ...input,
          conversationId: "conversation",
          messages: [
            { role: "user", content: "Private content for ingestion." },
          ],
        },
      };
}

function harness(stage: "create" | "embedding" | "upsert" | "complete") {
  const gate = barrier();
  let generation = 0;
  let status: "queued" | "processing" | "completed" | "failed" | undefined =
    "queued";
  let paused = false;
  const memories = new Map<string, unknown>();
  const vectors = new Set<string>();
  const otherTenant = new Map([["other-memory", "unaffected"]]);
  const assertGeneration = (expected: number | undefined) => {
    if (expected !== undefined && expected !== generation)
      throw new Error("ingestion_cancelled_by_purge");
  };
  const pause = async (point: typeof stage) => {
    if (point === stage && !paused) {
      paused = true;
      await gate.pause();
    }
  };
  const graph = {
    getIngestionGeneration: vi.fn(async () => generation),
    getMemory: vi.fn(async (id: string) => memories.get(id)),
    startIngestionJob: vi.fn(async (_id: string, expected = 0) => {
      if (expected !== generation || !status || status === "completed")
        return undefined;
      status = "processing";
      return { generation, sourceId: "same-source", status };
    }),
    createMemory: vi.fn(
      async (input: Record<string, unknown>, expected: number) => {
        await pause("create");
        assertGeneration(expected);
        const memory = {
          ...input,
          id: `memory-${generation}`,
          status: "active",
          isLatest: true,
        };
        memories.set(memory.id, memory);
        return memory;
      },
    ),
    linkRelatedMemories: vi.fn(async (_id: string, expected: number) => {
      assertGeneration(expected);
      return [];
    }),
    completeIngestionJob: vi.fn(
      async (_id: string, _result: unknown, expected: number) => {
        await pause("complete");
        assertGeneration(expected);
        status = "completed";
      },
    ),
    failIngestionJob: vi.fn(
      async (_id: string, _error: unknown, expected: number) => {
        assertGeneration(expected);
        status = "failed";
      },
    ),
  };
  const send = vi.fn(async () => {});
  const deleteByIds = vi.fn(async (ids: string[]) => {
    for (const id of ids) vectors.delete(id);
  });
  const env = {
    MEMORY_GRAPHS: {
      idFromName: (id: string) => id,
      get: (id: string) => {
        if (id !== "tenant-a") throw new Error("wrong tenant");
        return graph;
      },
    },
    AI: {
      run: async () => {
        await pause("embedding");
        return { data: [[0.1, 0.2]] };
      },
    },
    MEMORY_VECTORS: {
      upsert: async (rows: Array<{ id: string }>) => {
        await pause("upsert");
        for (const row of rows) vectors.add(row.id);
      },
      deleteByIds,
    },
    MEMORY_EXTRACTION_QUEUE: { send },
    EMBEDDING_MODEL: "@cf/test",
  } as unknown as Env;
  return {
    gate,
    env,
    graph,
    memories,
    vectors,
    otherTenant,
    deleteByIds,
    send,
    purge() {
      generation++;
      status = undefined;
      memories.clear();
      vectors.clear();
    },
    recreateJob() {
      status = "queued";
    },
    status: () => status,
  };
}

describe("ingestion purge barriers", () => {
  for (const kind of ["source", "conversation"] as const) {
    test.each([
      "create",
      "embedding",
      "upsert",
      "complete",
    ] as const)(`${kind}: purge during %s fences stale work and permits fresh ingestion`, async (stage) => {
      const h = harness(stage);
      const pending = processSourceIngestionMessage(h.env, message(kind));
      await h.gate.reached;
      h.purge();
      // A new job with the same identifier must not be completed by old work.
      h.recreateJob();
      h.gate.resume();
      await expect(pending).resolves.toMatchObject({
        chunkCount: 0,
        memories: [],
        edges: [],
      });
      expect(h.memories.size).toBe(0);
      expect(h.vectors.size).toBe(0);
      expect(h.status()).toBe("queued");
      expect(h.graph.failIngestionJob).not.toHaveBeenCalled();
      expect([...h.otherTenant]).toEqual([["other-memory", "unaffected"]]);
      if (stage === "embedding" || stage === "upsert")
        expect(h.deleteByIds).toHaveBeenCalledTimes(1);
      await expect(
        processSourceIngestionMessage(h.env, message(kind)),
      ).resolves.toMatchObject({ chunkCount: 0 });
      await expect(
        processSourceIngestionMessage(h.env, message(kind, 1)),
      ).resolves.toMatchObject({ chunkCount: 1 });
      expect(h.memories.size).toBe(1);
      expect(h.vectors.size).toBe(1);
      expect(h.status()).toBe("completed");
      await expect(
        processSourceIngestionMessage(h.env, message(kind, 1)),
      ).resolves.toMatchObject({ chunkCount: 0 });
      expect(h.memories.size).toBe(1);
    });
  }

  test("a pre-write transient failure is retryable within the same generation", async () => {
    const h = harness("complete");
    h.gate.resume();
    h.graph.createMemory.mockRejectedValueOnce(
      new Error("temporary storage failure"),
    );
    await expect(
      processSourceIngestionMessage(h.env, message("source")),
    ).rejects.toThrow("temporary storage failure");
    expect(h.status()).toBe("failed");
    expect(h.memories.size).toBe(0);
    expect(h.vectors.size).toBe(0);
    await expect(
      processSourceIngestionMessage(h.env, message("source")),
    ).resolves.toMatchObject({ chunkCount: 1 });
    expect(h.status()).toBe("completed");
    expect(h.memories.size).toBe(1);
  });

  test("provider cleanup failure cannot restore canonical data or complete a new job", async () => {
    const h = harness("upsert");
    h.deleteByIds.mockRejectedValueOnce(new Error("provider unavailable"));
    const pending = processSourceIngestionMessage(h.env, message("source"));
    await h.gate.reached;
    h.purge();
    h.recreateJob();
    h.gate.resume();
    await expect(pending).resolves.toMatchObject({
      chunkCount: 0,
      memories: [],
    });
    expect(h.memories.size).toBe(0);
    expect(h.status()).toBe("queued");
    // Physical index cleanup is not atomic with graph purge; do not hide this limit.
    expect(h.vectors.size).toBe(1);
    expect([...h.otherTenant]).toEqual([["other-memory", "unaffected"]]);
  });

  test("legacy extraction is rejected after purge before reading a restored same-ID memory", async () => {
    const graph = {
      getIngestionGeneration: vi.fn(async () => 1),
      getMemory: vi.fn(),
      applyExtractedSignals: vi.fn(),
    };
    const env = {
      MEMORY_GRAPHS: { idFromName: (id: string) => id, get: () => graph },
    } as unknown as Env;
    await expect(
      processMemoryExtractionMessage(env, {
        version: 1,
        memoryId: "same-id",
        tenantId: "tenant-a",
        reason: "create",
        requestedAt: "2026-10-17T00:00:00Z",
      }),
    ).resolves.toMatchObject({ applied: false });
    expect(graph.getMemory).not.toHaveBeenCalled();
    expect(graph.applyExtractedSignals).not.toHaveBeenCalled();
  });
  test("extraction read before purge cannot apply to a restored same-ID memory", async () => {
    const gate = barrier();
    let generation = 0;
    let restoredContent = "restored content";
    const graph = {
      getIngestionGeneration: vi.fn(async () => generation),
      getMemory: vi.fn(async () => ({ content: "old private content" })),
      applyExtractedSignals: vi.fn(
        async (_id: string, _signals: unknown, expected: number) => {
          await gate.pause();
          if (expected !== generation)
            throw new Error("ingestion_cancelled_by_purge");
          restoredContent = "modified by stale extraction";
          return { applied: true, edges: [] };
        },
      ),
    };
    const env = {
      MEMORY_GRAPHS: { idFromName: (id: string) => id, get: () => graph },
    } as unknown as Env;
    const pending = processMemoryExtractionMessage(env, {
      version: 1,
      generation: 0,
      memoryId: "same-id",
      tenantId: "tenant-a",
      reason: "create",
      requestedAt: "2026-10-17T00:00:00Z",
    });
    await gate.reached;
    generation++;
    gate.resume();
    await expect(pending).resolves.toMatchObject({ applied: false });
    expect(restoredContent).toBe("restored content");
  });
});
