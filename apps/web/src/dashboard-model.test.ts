import type { GraphEdge, GraphStats, Memory } from "@openmemory/client";
import { describe, expect, test } from "vitest";
import {
  getActivitySummary,
  getDashboardMetrics,
  getGraphHealthSummary,
  getGraphOperationsSummary,
  getIndexReadinessSummary,
  getKnowledgeMap,
  getLifecycleDistribution,
  getMemoryLabel,
  getMemoryNeighborDetails,
  getRecentActivity,
  getRelationshipDistribution,
  getRelationshipReadinessSummary,
  getSelectedNodeRelationships,
  getSourceIngestSummary,
  getTypeDistribution,
  getTypeDistributionSummary,
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

  test("summarizes capture cadence for chart sidebars", () => {
    const activity = getRecentActivity(
      memories,
      new Date("2026-07-01T12:00:00.000Z"),
    );

    expect(getActivitySummary(activity)).toEqual({
      activeDays: 2,
      peakCount: 3,
      peakLabel: "Tue",
      total: 4,
    });
  });

  test("sorts type distribution by count then label", () => {
    expect(getTypeDistribution(memories)).toEqual([
      { label: "decision", count: 1, percent: 100 },
      { label: "fact", count: 1, percent: 100 },
      { label: "insight", count: 1, percent: 100 },
      { label: "preference", count: 1, percent: 100 },
    ]);
  });

  test("summarizes type distribution for chart sidebars", () => {
    expect(getTypeDistributionSummary(getTypeDistribution(memories))).toEqual({
      leadingCount: 1,
      leadingLabel: "decision",
      leadingShare: 25,
      total: 4,
    });
  });

  test("summarizes memory lifecycle for dashboard health charts", () => {
    expect(getLifecycleDistribution(memories)).toEqual([
      { label: "active", count: 3, percent: 100 },
      { label: "historical", count: 0, percent: 0 },
      { label: "forgotten", count: 1, percent: 33 },
    ]);
  });

  test("summarizes graph health from dashboard metrics", () => {
    expect(
      getGraphHealthSummary({
        activeMemories: 4,
        totalMemories: 4,
        totalEdges: 5,
        relationshipCount: 3,
        entityCount: 6,
        tagCount: 10,
        oauthConnections: 0,
        recalledMemories: 4,
      }),
    ).toEqual({
      edgeDensity: 1.3,
      signalCoverage: 80,
      status: "Well linked",
    });
  });

  test("summarizes relationship readiness from graph metrics", () => {
    expect(
      getRelationshipReadinessSummary({
        activeMemories: 4,
        totalMemories: 4,
        totalEdges: 5,
        relationshipCount: 3,
        entityCount: 6,
        tagCount: 10,
        oauthConnections: 0,
        recalledMemories: 4,
      }),
    ).toEqual({
      relationshipDiversity: 60,
      status: "Typed graph",
    });
  });

  test("summarizes graph operations pressure for dashboard review", () => {
    expect(
      getGraphOperationsSummary({
        activeMemories: 240,
        totalMemories: 260,
        totalEdges: 720,
        relationshipCount: 6,
        entityCount: 220,
        tagCount: 30,
        oauthConnections: 2,
        recalledMemories: 230,
      }),
    ).toEqual({
      averageDegree: 3,
      benchmarkSize: 240,
      relationshipTypes: 6,
      status: "Benchmark ready",
      traversalBudget: "large fixture",
    });
  });

  test("summarizes index readiness from latest memory state", () => {
    expect(
      getIndexReadinessSummary([
        ...memories,
        memory({
          id: "mem_superseded",
          content: "Older project preference revision.",
          isLatest: false,
          status: "superseded",
        }),
      ]),
    ).toEqual({
      currentMemories: 3,
      currentShare: 75,
      staleMemories: 1,
      status: "Needs repair",
    });
  });

  test("summarizes completed source ingestion for the ingest view", () => {
    expect(
      getSourceIngestSummary({
        sourceId: "src_docs",
        chunkCount: 3,
        memories: memories.slice(0, 3),
        edges: edges.slice(0, 2),
      }),
    ).toEqual({
      chunkCount: 3,
      edgeCount: 2,
      leadingType: "decision",
      memoryCount: 3,
      sourceId: "src_docs",
      typeCount: 3,
    });
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

  test("filters knowledge map links by relationship while preserving visible nodes", () => {
    const graph = getKnowledgeMap(memories, edges, null, {
      relationship: "supports",
      search: "",
      type: "all",
    });

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "mem_ui",
      "mem_rag",
      "mem_arch",
    ]);
    expect(graph.links.map((link) => link.relationship)).toEqual(["supports"]);
  });

  test("summarizes visible graph relationships by count", () => {
    const graph = getKnowledgeMap(memories, edges, null);

    expect(getRelationshipDistribution(graph.links)).toEqual([
      { label: "informs", count: 1, percent: 100 },
      { label: "shared-signal", count: 1, percent: 100 },
      { label: "supports", count: 1, percent: 100 },
    ]);
  });

  test("describes relationships touching the selected graph node", () => {
    const graph = getKnowledgeMap(memories, edges, "mem_rag");

    expect(
      getSelectedNodeRelationships(graph).map((relationship) => ({
        direction: relationship.direction,
        relationship: relationship.relationship,
        memoryId: relationship.memory.id,
      })),
    ).toEqual([
      {
        direction: "outgoing",
        relationship: "informs",
        memoryId: "mem_ui",
      },
      {
        direction: "incoming",
        relationship: "supports",
        memoryId: "mem_arch",
      },
    ]);
  });

  test("prioritizes explicit selected relationships over fallback graph signals", () => {
    const graph = getKnowledgeMap(memories, edges, "mem_arch");

    expect(
      getSelectedNodeRelationships(graph).map(
        (relationship) => relationship.relationship,
      ),
    ).toEqual(["supports", "shared-signal"]);
  });

  test("resolves memory neighbor details without leaking raw edge ids first", () => {
    const details = getMemoryNeighborDetails(memories[0], edges, memories);

    expect(
      details.map((detail) => ({
        direction: detail.direction,
        memoryId: detail.relatedMemory?.id ?? detail.relatedMemoryId,
        relationship: detail.edge.relationship,
        weight: detail.edge.weight,
      })),
    ).toEqual([
      {
        direction: "outgoing",
        memoryId: "mem_rag",
        relationship: "supports",
        weight: 0.8,
      },
      {
        direction: "outgoing",
        memoryId: "mem_missing",
        relationship: "ignored",
        weight: 0.5,
      },
    ]);
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
