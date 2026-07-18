import type { SearchResult } from "@openmemory/core";
import { describe, expect, test } from "vitest";
import type { Env } from "../src/env";
import { rerankSearchResults } from "../src/recall";

describe("recall reranking", () => {
  test("applies Workers AI order for known candidate ids", async () => {
    const memories = makeResults(["mem_a", "mem_b", "mem_c"]);
    const env = makeEnv({
      response: { response: JSON.stringify({ ids: ["mem_c", "mem_a"] }) },
    });

    const results = await rerankSearchResults(env, "launch owner", memories);

    expect(results.map((result) => result.id)).toEqual([
      "mem_c",
      "mem_a",
      "mem_b",
    ]);
    expect(results[0]?.metadata.rerank).toEqual({
      status: "applied",
      model: "@cf/test/reranker",
    });
  });

  test("ignores duplicate and unknown ids from model output", async () => {
    const memories = makeResults(["mem_a", "mem_b", "mem_c"]);
    const env = makeEnv({
      response: {
        response: JSON.stringify({
          ids: ["mem_missing", "mem_b", "mem_b", "mem_a"],
        }),
      },
    });

    const results = await rerankSearchResults(env, "launch owner", memories);

    expect(results.map((result) => result.id)).toEqual([
      "mem_b",
      "mem_a",
      "mem_c",
    ]);
  });

  test("falls back to deterministic order when model output is invalid", async () => {
    const memories = makeResults(["mem_a", "mem_b", "mem_c"]);
    const env = makeEnv({ response: { response: "not json" } });

    const results = await rerankSearchResults(env, "launch owner", memories);

    expect(results.map((result) => result.id)).toEqual([
      "mem_a",
      "mem_b",
      "mem_c",
    ]);
    expect(results[0]?.metadata.rerank).toEqual({
      status: "empty",
    });
  });

  test("skips reranking without an explicit model", async () => {
    const memories = makeResults(["mem_a", "mem_b"]);

    const results = await rerankSearchResults({} as Env, "launch", memories);

    expect(results.map((result) => result.id)).toEqual(["mem_a", "mem_b"]);
    expect(results[0]?.metadata.rerank).toEqual({ status: "skipped" });
  });
});

function makeEnv(options: { response: unknown }): Env {
  return {
    AI: {
      run: async () => options.response,
    },
    EMBEDDING_MODEL: "@cf/test/embedding",
    OPENMEMORY_RERANK_MODEL: "@cf/test/reranker",
  } as unknown as Env;
}

function makeResults(ids: string[]): SearchResult[] {
  return ids.map((id, index) => ({
    id,
    content: `Memory ${id}`,
    source: "test",
    tags: [],
    metadata: {},
    type: "fact",
    status: "active",
    isLatest: true,
    confidence: 0.8,
    importance: 0.5,
    entityIds: [],
    score: 1 - index * 0.1,
    reason: "keyword",
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  }));
}
