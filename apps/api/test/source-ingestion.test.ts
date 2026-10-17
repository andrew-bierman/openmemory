import { describe, expect, test, vi } from "vitest";
import type { Env } from "../src/env";
import {
  type IngestionQueueMessage,
  processSourceIngestionMessage,
} from "../src/source-ingestion";

describe("source ingestion lifecycle", () => {
  test.each([
    "source",
    "conversation",
  ] as const)("does not recreate data from delayed %s delivery after its job was purged", async (kind) => {
    const jobs = new Set(["source-shared"]);
    const startIngestionJob = vi.fn(async (id: string) =>
      jobs.has(id) ? { sourceId: id, status: "processing" } : undefined,
    );
    const createMemory = vi.fn();
    const completeIngestionJob = vi.fn();
    const failIngestionJob = vi.fn();
    const graph = {
      startIngestionJob,
      createMemory,
      completeIngestionJob,
      failIngestionJob,
    };
    const otherGraph = { startIngestionJob: vi.fn() };
    const aiRun = vi.fn();
    const upsert = vi.fn();
    const send = vi.fn();
    const get = vi.fn((id: string) => (id === "tenant-a" ? graph : otherGraph));
    const env = {
      MEMORY_GRAPHS: { idFromName: (id: string) => id, get },
      AI: { run: aiRun },
      MEMORY_VECTORS: { upsert },
      MEMORY_EXTRACTION_QUEUE: { send },
    } as unknown as Env;
    const common = {
      version: 1 as const,
      sourceId: "source-shared",
      tenantId: "tenant-a",
      requestedAt: new Date().toISOString(),
    };
    const message: IngestionQueueMessage =
      kind === "source"
        ? {
            ...common,
            kind,
            input: {
              content: "Private source content",
              source: "test",
              tags: [],
              metadata: {},
              chunkSize: 1000,
              overlap: 0,
            },
          }
        : {
            ...common,
            kind,
            input: {
              conversationId: "conversation-a",
              messages: [
                { role: "user", content: "Private conversation content" },
              ],
              source: "test",
              tags: [],
              metadata: {},
              chunkSize: 1000,
              overlap: 0,
            },
          };

    // The canonical purge removes ingestion_jobs as well as memories.
    jobs.clear();
    await expect(processSourceIngestionMessage(env, message)).resolves.toEqual({
      sourceId: "source-shared",
      chunkCount: 0,
      memories: [],
      edges: [],
    });
    expect(get).toHaveBeenCalledWith("tenant-a");
    expect(startIngestionJob).toHaveBeenCalledWith("source-shared");
    expect(otherGraph.startIngestionJob).not.toHaveBeenCalled();
    for (const mutation of [
      createMemory,
      completeIngestionJob,
      failIngestionJob,
      aiRun,
      upsert,
      send,
    ]) {
      expect(mutation).not.toHaveBeenCalled();
    }
  });
});
