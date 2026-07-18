import { describe, expect, test } from "vitest";
import {
  CreateMemorySchema,
  createMemoryId,
  GraphEdgeSchema,
  GraphExportPayloadSchema,
  GraphRelationshipCatalog,
  getGraphRelationshipDefinition,
  importBenchmarkFixture,
  normalizeGraphRelationship,
  normalizeTenantId,
  SearchSchema,
} from ".";

describe("core contracts", () => {
  test("creates memory ids with the expected prefix", () => {
    expect(createMemoryId()).toMatch(/^mem_/);
  });

  test("normalizes tenant ids for durable object names", () => {
    expect(normalizeTenantId(" Team Alpha / User 42 ")).toBe(
      "team-alpha---user-42",
    );
  });

  test("rejects empty memory content", () => {
    expect(() => CreateMemorySchema.parse({ content: "" })).toThrow();
  });

  test("applies search defaults", () => {
    expect(SearchSchema.parse({ q: "typescript" })).toEqual({
      q: "typescript",
      limit: 10,
      tags: [],
      includeHistorical: false,
      includeForgotten: false,
    });
  });

  test("normalizes graph relationships into the canonical taxonomy", () => {
    expect(normalizeGraphRelationship("Shares Entity")).toBe("shares_entity");
    expect(
      GraphEdgeSchema.parse({
        sourceId: "a",
        targetId: "b",
        relationship: "next-chunk",
        metadata: {},
      }).relationship,
    ).toBe("next_chunk");
  });

  test("rejects graph relationships outside the launch taxonomy", () => {
    expect(() => normalizeGraphRelationship("maybe_related")).toThrow();
  });

  test("exports graph relationship definitions for API and UI consumers", () => {
    expect(GraphRelationshipCatalog.length).toBeGreaterThan(8);
    expect(getGraphRelationshipDefinition("updates")).toMatchObject({
      category: "versioning",
      defaultWeight: 1,
      direction: "forward",
    });
  });

  test("imports MemoryBench-style fixtures into a graph export payload", () => {
    const imported = importBenchmarkFixture(
      {
        version: 1,
        name: "launch-recall",
        memories: [
          {
            key: "maya-review",
            query: "Maya TypeScript review preference",
            content: "Maya prefers concise TypeScript code reviews.",
            tags: ["people", "reviews"],
            type: "preference",
            importance: 0.9,
            metadata: { cohort: "golden" },
          },
          {
            key: "atlas-launch",
            query: "Atlas launch date",
            content: "Atlas launch moved to Tuesday.",
            tags: ["projects"],
            type: "decision",
          },
        ],
        distractors: [
          "Maya likes long-form prose in book club notes.",
          {
            key: "atlas-coffee",
            content: "Atlas coffee chat moved to Thursday.",
            tags: ["distractor"],
          },
        ],
        cases: [
          {
            query: "Maya TypeScript review preference",
            targetKey: "maya-review",
          },
        ],
        edges: [
          {
            sourceKey: "maya-review",
            targetKey: "atlas-launch",
            relationship: "supports",
          },
        ],
      },
      { importedAt: "2026-07-18T00:00:00.000Z" },
    );

    expect(() =>
      GraphExportPayloadSchema.parse(imported.graphExport),
    ).not.toThrow();
    expect(imported.graphExport.memories).toHaveLength(4);
    expect(imported.graphExport.edges).toEqual([
      expect.objectContaining({
        sourceId: "mem_benchmark_maya_review",
        targetId: "mem_benchmark_atlas_launch",
        relationship: "supports",
        weight: getGraphRelationshipDefinition("supports").defaultWeight,
      }),
    ]);
    expect(imported.cases).toEqual([
      {
        query: "Maya TypeScript review preference",
        targetKey: "maya-review",
        targetId: "mem_benchmark_maya_review",
      },
    ]);
    expect(imported.graphExport.memories[0]).toMatchObject({
      id: "mem_benchmark_maya_review",
      source: "memorybench",
      metadata: {
        benchmarkName: "launch-recall",
        benchmarkKey: "maya-review",
        benchmarkRole: "target",
        benchmarkQuery: "Maya TypeScript review preference",
        cohort: "golden",
      },
    });
  });

  test("rejects benchmark fixtures with dangling case or edge references", () => {
    expect(() =>
      importBenchmarkFixture({
        version: 1,
        memories: [{ key: "known", content: "Known memory." }],
        cases: [{ query: "unknown", targetKey: "missing" }],
      }),
    ).toThrow(/unknown targetKey/);

    expect(() =>
      importBenchmarkFixture({
        version: 1,
        memories: [{ key: "known", content: "Known memory." }],
        edges: [
          {
            sourceKey: "known",
            targetKey: "missing",
            relationship: "supports",
          },
        ],
      }),
    ).toThrow(/unknown keys/);
  });

  test("rejects benchmark fixture keys that collapse to the same graph id", () => {
    expect(() =>
      importBenchmarkFixture({
        version: 1,
        memories: [
          { key: "Maya Review", content: "Known memory." },
          { key: "maya-review", content: "Duplicate slug." },
        ],
      }),
    ).toThrow(/duplicate ids/);
  });
});
