import { describe, expect, test } from "vitest";
import type { Env } from "../src/env";
import { getReadinessSnapshot } from "../src/readiness";

const graph = {
  async getIndexInventory() {
    return {
      indexableMemories: 2,
      purgeableMemories: 0,
      indexableMemoryIds: ["mem_1", "mem_2"],
      purgeableMemoryIds: [],
    };
  },
  async getRelationshipCatalog() {
    return [];
  },
  async getStats() {
    return {
      activeMemories: 2,
      totalMemories: 2,
      totalEdges: 1,
      relationshipCount: 1,
      relationshipDistribution: [],
      graphDensity: 0.5,
      entityCount: 2,
      tagCount: 1,
    };
  },
};

describe("readiness rerank diagnostics", () => {
  test("reports disabled rerank without a configured model", async () => {
    const readiness = await snapshot({});

    expect(readiness.rerank).toEqual({
      configured: false,
      workersAiConfigured: false,
      timeoutMs: 900,
      status: "disabled",
    });
    expect(readiness.warnings).not.toContain(
      "rerank_model_requires_workers_ai",
    );
  });

  test("warns when a rerank model is configured without Workers AI", async () => {
    const readiness = await snapshot({
      OPENMEMORY_RERANK_MODEL: "  @cf/test/reranker  ",
      OPENMEMORY_RERANK_TIMEOUT_MS: "1200",
    });

    expect(readiness.rerank).toEqual({
      configured: true,
      workersAiConfigured: false,
      model: "@cf/test/reranker",
      timeoutMs: 1200,
      status: "misconfigured",
    });
    expect(readiness.warnings).toContain("rerank_model_requires_workers_ai");
  });

  test("reports enabled rerank when a model and Workers AI are configured", async () => {
    const readiness = await snapshot({
      AI: { run: async () => ({ response: [] }) } as unknown as Env["AI"],
      OPENMEMORY_RERANK_MODEL: "@cf/test/reranker",
      OPENMEMORY_RERANK_TIMEOUT_MS: "0",
    });

    expect(readiness.rerank).toEqual({
      configured: true,
      workersAiConfigured: true,
      model: "@cf/test/reranker",
      timeoutMs: 900,
      status: "enabled",
    });
    expect(readiness.warnings).not.toContain(
      "rerank_model_requires_workers_ai",
    );
  });
});

async function snapshot(env: Partial<Env>) {
  return getReadinessSnapshot({
    env: {
      EMBEDDING_MODEL: "@cf/test/embedding",
      MEMORY_GRAPHS: {} as Env["MEMORY_GRAPHS"],
      ...env,
    },
    graph,
    request: new Request("http://127.0.0.1/v1/readiness", {
      headers: { "x-openmemory-user-id": "local-test" },
    }),
    tenantId: "local-test",
  });
}
