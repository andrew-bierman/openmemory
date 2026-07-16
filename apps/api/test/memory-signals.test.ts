import { describe, expect, test } from "vitest";
import {
  enrichMemoryInput,
  entityId,
  extractMemorySignals,
  mergeUnique,
} from "../src/memory-signals";

describe("memory signal extraction", () => {
  test("normalizes entity ids for graph linking", () => {
    expect(entityId(" Graph Indexing / OpenMemory ")).toBe(
      "graph-indexing-openmemory",
    );
  });

  test("extracts titlecase entities, acronyms, hashtags, and domain tags", () => {
    const signals = extractMemorySignals(
      "Boris maintains Graph Indexing for RAG and OAuth in Cloudflare. #Architecture",
    );

    expect(signals.entityIds).toEqual(
      expect.arrayContaining(["boris", "graph-indexing", "rag"]),
    );
    expect(signals.entityIds).not.toContain("architecture");
    expect(signals.tags).toEqual(
      expect.arrayContaining(["architecture", "cloudflare", "rag", "oauth"]),
    );
  });

  test("does not treat common sentence starters as entities", () => {
    const signals = extractMemorySignals(
      "The Graph Indexing pipeline updates recall.",
    );

    expect(signals.entityIds).not.toContain("the");
    expect(signals.entityIds).toContain("graph-indexing");
  });

  test("extracts deterministic relationship candidates", () => {
    const signals = extractMemorySignals(
      "Graph Indexing depends on RAG. Vectorize supports Graph Indexing.",
    );

    expect(signals.relationships).toContainEqual(
      expect.objectContaining({
        sourceEntityId: "graph-indexing",
        targetEntityId: "rag",
        relationship: "depends_on",
      }),
    );
    expect(signals.relationships).toContainEqual(
      expect.objectContaining({
        sourceEntityId: "vectorize",
        targetEntityId: "graph-indexing",
        relationship: "supports",
      }),
    );
  });

  test("merges unique values while preserving first occurrence order", () => {
    expect(mergeUnique([" graph ", "rag", "graph", "", "mcp"])).toEqual([
      "graph",
      "rag",
      "mcp",
    ]);
  });

  test("enriches input without overwriting explicit tags, entities, or metadata", () => {
    const enriched = enrichMemoryInput({
      content: "Graph Indexing supports RAG recall.",
      tags: ["manual"],
      entityIds: ["custom-entity"],
      metadata: { sourceId: "doc-1" },
    });

    expect(enriched.tags).toEqual(
      expect.arrayContaining(["manual", "graph", "rag"]),
    );
    expect(enriched.entityIds).toEqual(
      expect.arrayContaining(["custom-entity", "graph-indexing", "rag"]),
    );
    const metadata = enriched.metadata as Record<string, unknown>;
    expect(metadata.sourceId).toBe("doc-1");
    const extraction = metadata.extraction as Record<string, unknown>;
    expect(extraction).toMatchObject({
      strategy: "deterministic-v1",
    });
  });
});
