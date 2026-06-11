import { describe, expect, test } from "vitest";
import {
  CreateMemorySchema,
  createMemoryId,
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
});
