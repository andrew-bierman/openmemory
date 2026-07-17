import { describe, expect, test } from "vitest";
import {
  CreateMemorySchema,
  createMemoryId,
  getGraphRelationshipDefinition,
  GraphEdgeSchema,
  GraphRelationshipCatalog,
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
    expect(GraphEdgeSchema.parse({
      sourceId: "a",
      targetId: "b",
      relationship: "next-chunk",
      metadata: {},
    }).relationship).toBe("next_chunk");
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
});
