import type { GraphEdge, GraphStats, Memory } from "@openmemory/client";
import { describe, expect, test } from "vitest";
import {
  getDashboardMetrics,
  getKnowledgeMap,
  getMemoryLabel,
  getRecentActivity,
  getTypeDistribution,
} from "./dashboard-model";

describe("dashboard model", () => {
  test("derives dashboard metrics from graph stats when present", () => {
    const stats: GraphStats = {
      totalMemories: 12,
      activeMemories: 9,
      historicalMemories: 2,
      forgottenMemories: 1,
      totalEdges: 21,
      relationshipCount: 4,
      entityCount: 18,
      tagCount: 7,
      generatedAt: "2026-07-01T12:00:00.000Z",
    };

    expect(getDashboardMetrics(memories, stats, [oauthConnection])).toEqual({
      activeMemories: 9,
      totalMemories: 12,
      totalEdges: 21,
      relationshipCount: 4,
      entityCount: 18,
      tagCount: 7,
      oauthConnections: 1,
      recalledMemories: 3,
    });
  });

  test("falls back to memory signals when graph stats are unavailable", () => {
    expect(getDashboardMetrics(memories, null, [])).toMatchObject({
      activeMemories: 3,
      totalMemories: 4,
      entityCount: 5,
      tagCount: 7,
      oauthConnections: 0,
      recalledMemories: 3,
    });
  });

  test("builds a seven-day activity series against a stable clock", () => {
    const activity = getRecentActivity(
      memories,
      new Date("2026-07-01T12:00:00.000Z"),
    );

    expect(activity).toHaveLength(7);
    expect(activity.map((point) => point.key)).toEqual([
      "2026-06-25",
      "2026-06-26",
      "2026-06-27",
      "2026-06-28",
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
    ]);
    expect(activity.map((point) => point.count)).toEqual([0, 0, 0, 0, 0, 3, 1]);
    expect(activity.at(-2)?.percent).toBe(100);
    expect(activity.at(-1)?.percent).toBe(33);
  });

  test("sorts type distribution by count then label", () => {
    expect(getTypeDistribution(memories)).toEqual([
      { label: "decision", count: 1, percent: 100 },
      { label: "fact", count: 1, percent: 100 },
      { label: "insight", count: 1, percent: 100 },
      { label: "preference", count: 1, percent: 100 },
    ]);
  });

  test("filters knowledge map by content, tags, entities, and memory type", () => {
    const graph = getKnowledgeMap(memories, edges, null, {
      search: "cloudflare",
      type: "decision",
    });

    expect(graph.nodes.map((node) => node.id)).toEqual(["mem_arch"]);
    expect(graph.links).toEqual([]);
  });

  test("keeps selected memory visible even when filters exclude it", () => {
    const graph = getKnowledgeMap(memories, edges, "mem_rag", {
      search: "cloudflare",
      type: "decision",
    });

    expect(graph.nodes.map((node) => node.id)).toEqual(["mem_rag", "mem_arch"]);
    expect(graph.nodes[0]?.isSelected).toBe(true);
    expect(graph.links.map((link) => link.relationship)).toContain("supports");
  });

  test("falls back to shared signals without duplicating explicit edges", () => {
    const graph = getKnowledgeMap(memories, edges, null);

    expect(graph.nodes).toHaveLength(3);
    expect(
      graph.links.filter((link) => link.relationship === "supports"),
    ).toHaveLength(1);
    expect(
      graph.links.some((link) => link.relationship === "shared-signal"),
    ).toBe(true);
  });

  test("truncates long memory labels for graph cards and canvas labels", () => {
    expect(getMemoryLabel(memories[0])).toBe("OpenMemory uses D...");
    expect(getMemoryLabel({ content: "Short label" })).toBe("Short label");
  });
});

const memories: Memory[] = [
  memory({
    id: "mem_arch",
    content:
      "OpenMemory uses Durable Objects as the graph authority on Cloudflare.",
    tags: ["architecture", "cloudflare"],
    entityIds: ["cloudflare", "durable-objects"],
    type: "decision",
    createdAt: "2026-06-30T10:00:00.000Z",
  }),
  memory({
    id: "mem_rag",
    content:
      "Recall combines graph traversal and Vectorize semantic retrieval.",
    tags: ["rag", "vectorize"],
    entityIds: ["vectorize"],
    type: "insight",
    createdAt: "2026-06-30T11:00:00.000Z",
  }),
  memory({
    id: "mem_ui",
    content:
      "The control plane uses shadcn, TanStack, charts, and a graph explorer.",
    tags: ["ui", "shadcn", "architecture"],
    entityIds: ["tanstack"],
    type: "preference",
    createdAt: "2026-06-30T12:00:00.000Z",
  }),
  memory({
    id: "mem_old",
    content: "Forgotten memories do not appear in the active graph.",
    tags: ["archive"],
    entityIds: ["archive"],
    type: "fact",
    status: "forgotten",
    isLatest: false,
    createdAt: "2026-07-01T09:00:00.000Z",
  }),
];

const edges: GraphEdge[] = [
  {
    sourceId: "mem_arch",
    targetId: "mem_rag",
    relationship: "supports",
    weight: 0.8,
    metadata: {},
  },
  {
    sourceId: "mem_rag",
    targetId: "mem_ui",
    relationship: "informs",
    weight: 0.7,
    metadata: {},
  },
  {
    sourceId: "mem_arch",
    targetId: "mem_missing",
    relationship: "ignored",
    weight: 0.5,
    metadata: {},
  },
];

const oauthConnection = {
  clientId: "client_1",
  name: "Claude Desktop",
  scopes: ["memory:read"],
  redirectUris: ["http://localhost/callback"],
  disabled: false,
};

function memory(
  input: Partial<Memory> & Pick<Memory, "id" | "content">,
): Memory {
  const createdAt = input.createdAt ?? "2026-06-30T10:00:00.000Z";
  return {
    tags: [],
    entityIds: [],
    type: "fact",
    status: "active",
    isLatest: true,
    updatedAt: createdAt,
    createdAt,
    ...input,
  };
}
