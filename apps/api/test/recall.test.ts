import type { SearchResult } from "@openmemory/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Env } from "../src/env";
import { buildRecallContext, rerankSearchResults } from "../src/recall";

describe("recall reranking", () => {
  afterEach(() => vi.useRealTimers());
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
      status: "fallback",
      reason: "invalid_output",
      model: "@cf/test/reranker",
    });
  });

  test.each([
    "async rejection",
    "sync throw",
  ])("classifies %s without leaking provider details", async (mode) => {
    const memories = makeResults(["mem_a", "mem_b"]);
    const env = makeEnv({ response: {} });
    env.AI.run = (() => {
      const error = new Error("private provider prompt");
      if (mode === "sync throw") throw error;
      return Promise.reject(error);
    }) as NonNullable<Env["AI"]>["run"];
    const results = await rerankSearchResults(env, "private query", memories);
    expect(results.map((result) => result.id)).toEqual(["mem_a", "mem_b"]);
    expect(results[0]?.metadata.rerank).toEqual({
      status: "fallback",
      reason: "provider_error",
      model: "@cf/test/reranker",
    });
    expect(JSON.stringify(results)).not.toContain("private");
  });

  test("times out and safely observes a later provider rejection", async () => {
    vi.useFakeTimers();
    const env = makeEnv({ response: {} });
    let reject!: (error: Error) => void;
    env.AI.run = (() =>
      new Promise((_, fail) => {
        reject = fail;
      })) as NonNullable<Env["AI"]>["run"];
    env.OPENMEMORY_RERANK_TIMEOUT_MS = "10";
    const pending = rerankSearchResults(
      env,
      "query",
      makeResults(["mem_a", "mem_b"]),
    );
    await vi.advanceTimersByTimeAsync(10);
    const results = await pending;
    expect(results.map((result) => result.id)).toEqual(["mem_a", "mem_b"]);
    expect(results[0]?.metadata.rerank).toEqual({
      status: "fallback",
      reason: "timeout",
      model: "@cf/test/reranker",
    });
    reject(new Error("late private provider failure"));
    await vi.advanceTimersByTimeAsync(0);
  });

  test.each([
    {
      response: { response: '{"ids":[]}' },
      status: "empty",
      reason: undefined,
    },
    {
      response: { response: '{"ids":["unknown"]}' },
      status: "fallback",
      reason: "invalid_output",
    },
    {
      response: { response: '{"ids":[123]}' },
      status: "fallback",
      reason: "invalid_output",
    },
    { response: null, status: "fallback", reason: "invalid_output" },
    {
      response: { response: '{"ids":"mem_a"}' },
      status: "fallback",
      reason: "invalid_output",
    },
  ])("distinguishes empty output from invalid output: $response", async ({
    response,
    status,
    reason,
  }) => {
    const results = await rerankSearchResults(
      makeEnv({ response }),
      "query",
      makeResults(["mem_a", "mem_b"]),
    );
    expect(results.map((result) => result.id)).toEqual(["mem_a", "mem_b"]);
    expect(results[0]?.metadata.rerank).toEqual({
      status,
      model: "@cf/test/reranker",
      ...(reason ? { reason } : {}),
    });
  });

  test("exposes the bounded failure reason in recall context metadata", async () => {
    const result = await buildRecallContext(
      makeEnv({ response: { response: "invalid" } }),
      "tenant",
      {
        search: async () => makeResults(["mem_a", "mem_b"]),
        getProfile: async () => {
          throw new Error("profile should not be requested");
        },
      },
      { q: "query", limit: 2, includeProfile: false, includeHistorical: false },
    );
    expect(result.rerank).toEqual({
      attempted: true,
      applied: false,
      model: "@cf/test/reranker",
      candidateCount: 2,
      reason: "invalid_output",
    });
  });

  test("skips reranking without an explicit model", async () => {
    const memories = makeResults(["mem_a", "mem_b"]);

    const results = await rerankSearchResults({} as Env, "launch", memories);

    expect(results.map((result) => result.id)).toEqual(["mem_a", "mem_b"]);
    expect(results[0]?.metadata.rerank).toEqual({ status: "skipped" });
  });
});

function makeEnv(options: {
  response: unknown;
}): Env & { AI: NonNullable<Env["AI"]> } {
  return {
    AI: {
      run: async () => options.response,
    },
    EMBEDDING_MODEL: "@cf/test/embedding",
    OPENMEMORY_RERANK_MODEL: "@cf/test/reranker",
  } as unknown as Env & { AI: NonNullable<Env["AI"]> };
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
