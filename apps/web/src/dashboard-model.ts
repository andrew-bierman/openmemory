import type {
  GraphEdge,
  GraphImportPreviewResult,
  GraphStats,
  Memory,
  OAuthConnection,
  ReadinessSnapshot,
  SourceIngestResult,
} from "@openmemory/client";

export function getDashboardMetrics(
  memories: Memory[],
  graphStats: GraphStats | null,
  oauthConnections: OAuthConnection[],
): DashboardMetrics {
  const activeMemories =
    graphStats?.activeMemories ??
    memories.filter((memory) => memory.status === "active").length;

  return {
    activeMemories,
    totalMemories: graphStats?.totalMemories ?? memories.length,
    totalEdges: graphStats?.totalEdges ?? 0,
    relationshipCount: graphStats?.relationshipCount ?? 0,
    entityCount:
      graphStats?.entityCount ??
      new Set(memories.flatMap((memory) => memory.entityIds)).size,
    tagCount:
      graphStats?.tagCount ??
      new Set(memories.flatMap((memory) => memory.tags)).size,
    oauthConnections: oauthConnections.length,
    recalledMemories: memories.filter((memory) => memory.isLatest).length,
  };
}

export function getRecentActivity(
  memories: Memory[],
  now = new Date(),
): ActivityPoint[] {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (6 - index));
    return {
      key: date.toISOString().slice(0, 10),
      label: date
        .toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short" })
        .slice(0, 3),
      count: 0,
      percent: 0,
    };
  });
  const dayByKey = new Map(days.map((day) => [day.key, day]));

  for (const memory of memories) {
    const key = new Date(memory.createdAt).toISOString().slice(0, 10);
    const day = dayByKey.get(key);
    if (day) {
      day.count += 1;
    }
  }

  const max = Math.max(1, ...days.map((day) => day.count));
  return days.map((day) => ({
    ...day,
    percent: Math.round((day.count / max) * 100),
  }));
}

export function getTypeDistribution(memories: Memory[]): DistributionPoint[] {
  const counts = new Map<string, number>();
  for (const memory of memories) {
    counts.set(memory.type, (counts.get(memory.type) ?? 0) + 1);
  }
  const max = Math.max(1, ...counts.values());

  return Array.from(counts, ([label, count]) => ({
    label,
    count,
    percent: Math.round((count / max) * 100),
  })).sort(
    (left, right) =>
      right.count - left.count || left.label.localeCompare(right.label),
  );
}

export function getLifecycleDistribution(
  memories: Memory[],
): DistributionPoint[] {
  const counts = new Map([
    ["active", 0],
    ["historical", 0],
    ["forgotten", 0],
  ]);

  for (const memory of memories) {
    if (memory.status === "forgotten") {
      counts.set("forgotten", (counts.get("forgotten") ?? 0) + 1);
    } else if (memory.status !== "active" || !memory.isLatest) {
      counts.set("historical", (counts.get("historical") ?? 0) + 1);
    } else {
      counts.set("active", (counts.get("active") ?? 0) + 1);
    }
  }

  const max = Math.max(1, ...counts.values());
  return Array.from(counts, ([label, count]) => ({
    label,
    count,
    percent: Math.round((count / max) * 100),
  }));
}

export function getActivitySummary(activity: ActivityPoint[]): ActivitySummary {
  const total = activity.reduce((sum, point) => sum + point.count, 0);
  const activeDays = activity.filter((point) => point.count > 0).length;
  const peak = activity.reduce<ActivityPoint | null>((currentPeak, point) => {
    if (!currentPeak || point.count > currentPeak.count) {
      return point;
    }

    return currentPeak;
  }, null);

  return {
    activeDays,
    peakCount: peak?.count ?? 0,
    peakLabel: peak?.label ?? "None",
    total,
  };
}

export function getTypeDistributionSummary(
  distribution: DistributionPoint[],
): TypeDistributionSummary {
  const total = distribution.reduce((sum, point) => sum + point.count, 0);
  const leading = distribution[0] ?? null;

  return {
    leadingCount: leading?.count ?? 0,
    leadingLabel: leading?.label ?? "None",
    leadingShare:
      leading && total > 0 ? Math.round((leading.count / total) * 100) : 0,
    total,
  };
}

export function getGraphHealthSummary(
  metrics: DashboardMetrics,
): GraphHealthSummary {
  const activeMemories = Math.max(0, metrics.activeMemories);
  const edgeDensity =
    activeMemories > 0
      ? Number((metrics.totalEdges / activeMemories).toFixed(1))
      : 0;
  const signalCoverage =
    activeMemories > 0
      ? Math.min(
          100,
          Math.round(
            ((metrics.entityCount + metrics.tagCount) / activeMemories) * 20,
          ),
        )
      : 0;
  const status =
    metrics.totalEdges === 0
      ? "Needs edges"
      : edgeDensity >= 1 && signalCoverage >= 80
        ? "Well linked"
        : "Building";

  return {
    edgeDensity,
    signalCoverage,
    status,
  };
}

export function getRelationshipReadinessSummary(
  metrics: DashboardMetrics,
): RelationshipReadinessSummary {
  const relationshipDiversity =
    metrics.totalEdges > 0
      ? Math.min(
          100,
          Math.round((metrics.relationshipCount / metrics.totalEdges) * 100),
        )
      : 0;
  const status =
    metrics.relationshipCount === 0
      ? "No relationships"
      : metrics.relationshipCount >= 3
        ? "Typed graph"
        : "Basic graph";

  return {
    relationshipDiversity,
    status,
  };
}

export function getGraphOperationsSummary(
  metrics: DashboardMetrics,
): GraphOperationsSummary {
  const benchmarkSize = metrics.activeMemories;
  const averageDegree =
    benchmarkSize > 0
      ? Number((metrics.totalEdges / benchmarkSize).toFixed(1))
      : 0;
  const traversalBudget =
    benchmarkSize >= 200
      ? "large fixture"
      : benchmarkSize >= 100
        ? "moderate fixture"
        : "starter graph";
  const status =
    benchmarkSize >= 200 && averageDegree >= 2
      ? "Benchmark ready"
      : benchmarkSize >= 100
        ? "Needs larger fixture"
        : "Needs seed data";

  return {
    averageDegree,
    benchmarkSize,
    relationshipTypes: metrics.relationshipCount,
    status,
    traversalBudget,
  };
}

export function getIndexReadinessSummary(
  memories: Memory[],
  readiness?: ReadinessSnapshot | null,
): IndexReadinessSummary {
  if (readiness?.semanticIndex) {
    const { semanticIndex } = readiness;
    const currentMemories = semanticIndex.expectedVectors;
    const totalIndexCandidates =
      semanticIndex.expectedVectors + semanticIndex.staleVectorCandidates;
    const currentShare =
      totalIndexCandidates > 0
        ? Math.round((currentMemories / totalIndexCandidates) * 100)
        : 0;
    const status =
      semanticIndex.expectedVectors === 0
        ? "Empty"
        : semanticIndex.repairRecommended
          ? "Needs repair"
          : "Current";

    return {
      currentMemories,
      currentShare,
      staleMemories: semanticIndex.staleVectorCandidates,
      status,
    };
  }

  const indexedMemories = memories.filter(
    (memory) => memory.status !== "forgotten",
  );
  const staleMemories = indexedMemories.filter((memory) => !memory.isLatest);
  const currentMemories = indexedMemories.length - staleMemories.length;
  const currentShare =
    indexedMemories.length > 0
      ? Math.round((currentMemories / indexedMemories.length) * 100)
      : 0;
  const status =
    indexedMemories.length === 0
      ? "Empty"
      : staleMemories.length > 0
        ? "Needs repair"
        : "Current";

  return {
    currentMemories,
    currentShare,
    staleMemories: staleMemories.length,
    status,
  };
}

export function getSourceIngestSummary(
  result: SourceIngestResult,
): SourceIngestSummary {
  const memoryTypes = getTypeDistribution(result.memories);
  const leadingType = memoryTypes[0] ?? null;

  return {
    chunkCount: result.chunkCount,
    edgeCount: result.edges.length,
    leadingType: leadingType?.label ?? "None",
    memoryCount: result.memories.length,
    sourceId: result.sourceId,
    typeCount: memoryTypes.length,
  };
}

export function getGraphImportPreviewSummary(
  preview: GraphImportPreviewResult | null,
): GraphImportPreviewSummary {
  if (!preview) {
    return {
      changedDuplicates: 0,
      duplicateMemories: 0,
      edgesImported: 0,
      memoriesImported: 0,
      memoriesOverwritten: 0,
      memoriesSkipped: 0,
      newMemories: 0,
      status: "Waiting for preview",
      tone: "neutral",
    };
  }

  const changedDuplicates = preview.conflicts.changedMemoryIds.length;
  const memoriesOverwritten = preview.impact.memoriesOverwritten ?? 0;
  const tone =
    preview.mode === "replace"
      ? "danger"
      : changedDuplicates > 0 && preview.conflictPolicy === "skip"
        ? "warn"
        : "good";
  const status =
    preview.mode === "replace"
      ? "Replace will delete current graph"
      : changedDuplicates > 0 && preview.conflictPolicy === "skip"
        ? "Changed duplicates will be skipped"
        : memoriesOverwritten > 0
          ? "Changed duplicates will be overwritten"
          : "Merge is ready";

  return {
    changedDuplicates,
    duplicateMemories: preview.conflicts.duplicateMemoryIds.length,
    edgesImported: preview.impact.edgesImported,
    memoriesImported: preview.impact.memoriesImported,
    memoriesOverwritten,
    memoriesSkipped: preview.impact.memoriesSkipped,
    newMemories: preview.candidates.newMemoryIds.length,
    status,
    tone,
  };
}

export function getReadinessSummary(
  readiness: ReadinessSnapshot | null,
): ReadinessSummary {
  if (!readiness) {
    return {
      configuredBindings: 0,
      graphStatus: "Unknown",
      mcpStatus: "Unknown",
      productionReady: false,
      rerankStatus: "Unknown",
      totalBindings: 0,
      warningCount: 0,
    };
  }

  const bindings = Object.values(readiness.bindings);
  const configuredBindings = bindings.filter(Boolean).length;
  const graphStatus =
    readiness.graph.activeMemories === 0
      ? "Empty"
      : readiness.graph.totalEdges === 0
        ? "Needs edges"
        : readiness.graph.relationshipTypes >= 3
          ? "Typed graph"
          : "Basic graph";
  const mcpStatus =
    readiness.mcp.tools.length >= 4 && readiness.auth.betterAuthUrl
      ? "Discoverable"
      : "Incomplete";
  const rerankStatus =
    readiness.rerank.status === "enabled"
      ? "AI rerank"
      : readiness.rerank.status === "misconfigured"
        ? "Needs AI"
        : "Deterministic";

  return {
    configuredBindings,
    graphStatus,
    mcpStatus,
    productionReady:
      readiness.warnings.length === 0 &&
      readiness.bindings.authDb &&
      readiness.bindings.durableObjects &&
      readiness.rateLimit.enabled,
    rerankStatus,
    totalBindings: bindings.length,
    warningCount: readiness.warnings.length,
  };
}

export function getRelationshipDistribution(
  links: KnowledgeLink[],
): DistributionPoint[] {
  const counts = new Map<string, number>();
  for (const link of links) {
    counts.set(link.relationship, (counts.get(link.relationship) ?? 0) + 1);
  }
  const max = Math.max(1, ...counts.values());

  return Array.from(counts, ([label, count]) => ({
    label,
    count,
    percent: Math.round((count / max) * 100),
  })).sort(
    (left, right) =>
      right.count - left.count || left.label.localeCompare(right.label),
  );
}

export function getSelectedNodeRelationships(
  graph: KnowledgeGraph,
): SelectedNodeRelationship[] {
  const selectedNode = graph.nodes.find((node) => node.isSelected);
  if (!selectedNode) {
    return [];
  }

  const relationships: SelectedNodeRelationship[] = [];

  for (const link of graph.links) {
    if (link.source.id === selectedNode.id) {
      relationships.push({
        direction: "outgoing",
        relationship: link.relationship,
        memory: link.target.memory,
      });
    }

    if (link.target.id === selectedNode.id) {
      relationships.push({
        direction: "incoming",
        relationship: link.relationship,
        memory: link.source.memory,
      });
    }
  }

  return relationships.sort(
    (left, right) =>
      getRelationshipPriority(left.relationship) -
        getRelationshipPriority(right.relationship) ||
      left.relationship.localeCompare(right.relationship) ||
      left.memory.type.localeCompare(right.memory.type) ||
      left.memory.content.localeCompare(right.memory.content),
  );
}

export function getMemoryNeighborDetails(
  memory: Memory,
  neighbors: GraphEdge[],
  memories: Memory[],
): MemoryNeighborDetail[] {
  const memoryById = new Map(
    memories.map((candidate) => [candidate.id, candidate]),
  );
  const details: MemoryNeighborDetail[] = [];

  for (const edge of neighbors) {
    if (edge.sourceId === memory.id) {
      const relatedMemoryId = edge.targetId;
      details.push({
        direction: "outgoing",
        edge,
        relatedMemory: memoryById.get(relatedMemoryId) ?? null,
        relatedMemoryId,
      });
    }

    if (edge.targetId === memory.id) {
      const relatedMemoryId = edge.sourceId;
      details.push({
        direction: "incoming",
        edge,
        relatedMemory: memoryById.get(relatedMemoryId) ?? null,
        relatedMemoryId,
      });
    }
  }

  return details.sort(
    (left, right) =>
      getRelationshipPriority(left.edge.relationship) -
        getRelationshipPriority(right.edge.relationship) ||
      right.edge.weight - left.edge.weight ||
      left.edge.relationship.localeCompare(right.edge.relationship) ||
      (left.relatedMemory?.content ?? left.relatedMemoryId).localeCompare(
        right.relatedMemory?.content ?? right.relatedMemoryId,
      ),
  );
}

export function getKnowledgeMap(
  memories: Memory[],
  neighbors: GraphEdge[],
  selectedMemoryId: string | null,
  filters: GraphFilters = { search: "", type: "all", relationship: "all" },
): KnowledgeGraph {
  const search = filters.search.trim().toLowerCase();
  const relationship = filters.relationship ?? "all";
  const visibleMemories = memories
    .filter((memory) => {
      if (memory.status === "forgotten") {
        return false;
      }

      if (filters.type !== "all" && memory.type !== filters.type) {
        return false;
      }

      if (!search) {
        return true;
      }

      return [
        memory.content,
        memory.type,
        memory.status,
        ...memory.tags,
        ...memory.entityIds,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    })
    .slice()
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )
    .slice(0, 18);
  const selectedMemory = selectedMemoryId
    ? memories.find((memory) => memory.id === selectedMemoryId)
    : null;

  if (
    selectedMemory &&
    !visibleMemories.some((memory) => memory.id === selectedMemory.id)
  ) {
    visibleMemories.unshift(selectedMemory);
  }

  const centerX = 360;
  const centerY = 178;
  const radiusX = 260;
  const radiusY = 112;
  const nodes = visibleMemories.map((memory, index) => {
    const angle =
      (index / Math.max(1, visibleMemories.length)) * Math.PI * 2 - Math.PI / 2;
    const isSelected = memory.id === selectedMemoryId;
    return {
      id: memory.id,
      label: getMemoryLabel(memory),
      title: memory.content,
      x: Math.round(centerX + Math.cos(angle) * radiusX),
      y: Math.round(centerY + Math.sin(angle) * radiusY),
      size: isSelected
        ? 13
        : Math.min(10, 6 + memory.tags.length + memory.entityIds.length),
      isSelected,
      memory,
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const links: KnowledgeLink[] = [];
  const linkKeys = new Set<string>();

  for (const edge of neighbors) {
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    if (source && target) {
      const key = [source.id, target.id, edge.relationship].join(":");
      linkKeys.add(key);
      links.push({ source, target, relationship: edge.relationship });
    }
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const source = nodes[index];
    for (let nextIndex = index + 1; nextIndex < nodes.length; nextIndex += 1) {
      const target = nodes[nextIndex];
      if (!sharesMemorySignal(source.memory, target.memory)) {
        continue;
      }
      const key = [source.id, target.id, "shared-signal"].join(":");
      if (!linkKeys.has(key) && links.length < 34) {
        linkKeys.add(key);
        links.push({ source, target, relationship: "shared-signal" });
      }
    }
  }

  return {
    nodes,
    links:
      relationship === "all"
        ? links
        : links.filter((link) => link.relationship === relationship),
  };
}

export function getMemoryLabel(memory: Pick<Memory, "content">) {
  const clean = memory.content.replace(/\s+/g, " ").trim();
  if (clean.length <= 18) {
    return clean;
  }

  return `${clean.slice(0, 17)}...`;
}

function sharesMemorySignal(left: Memory, right: Memory) {
  const leftSignals = new Set([...left.tags, ...left.entityIds, left.type]);
  return [...right.tags, ...right.entityIds, right.type].some((signal) =>
    leftSignals.has(signal),
  );
}

function getRelationshipPriority(relationship: string) {
  return relationship === "shared-signal" || relationship.startsWith("shares_")
    ? 1
    : 0;
}

export type DashboardMetrics = {
  activeMemories: number;
  totalMemories: number;
  totalEdges: number;
  relationshipCount: number;
  entityCount: number;
  tagCount: number;
  oauthConnections: number;
  recalledMemories: number;
};

export type ActivityPoint = {
  key: string;
  label: string;
  count: number;
  percent: number;
};

export type DistributionPoint = {
  label: string;
  count: number;
  percent: number;
};

export type ActivitySummary = {
  activeDays: number;
  peakCount: number;
  peakLabel: string;
  total: number;
};

export type TypeDistributionSummary = {
  leadingCount: number;
  leadingLabel: string;
  leadingShare: number;
  total: number;
};

export type GraphHealthSummary = {
  edgeDensity: number;
  signalCoverage: number;
  status: "Building" | "Needs edges" | "Well linked";
};

export type RelationshipReadinessSummary = {
  relationshipDiversity: number;
  status: "Basic graph" | "No relationships" | "Typed graph";
};

export type GraphOperationsSummary = {
  averageDegree: number;
  benchmarkSize: number;
  relationshipTypes: number;
  status: "Benchmark ready" | "Needs larger fixture" | "Needs seed data";
  traversalBudget: "large fixture" | "moderate fixture" | "starter graph";
};

export type IndexReadinessSummary = {
  currentMemories: number;
  currentShare: number;
  staleMemories: number;
  status: "Current" | "Empty" | "Needs repair";
};

export type SourceIngestSummary = {
  chunkCount: number;
  edgeCount: number;
  leadingType: string;
  memoryCount: number;
  sourceId: string;
  typeCount: number;
};

export type GraphImportPreviewSummary = {
  changedDuplicates: number;
  duplicateMemories: number;
  edgesImported: number;
  memoriesImported: number;
  memoriesOverwritten: number;
  memoriesSkipped: number;
  newMemories: number;
  status:
    | "Changed duplicates will be overwritten"
    | "Changed duplicates will be skipped"
    | "Merge is ready"
    | "Replace will delete current graph"
    | "Waiting for preview";
  tone: "danger" | "good" | "neutral" | "warn";
};

export type ReadinessSummary = {
  configuredBindings: number;
  graphStatus:
    | "Basic graph"
    | "Empty"
    | "Needs edges"
    | "Typed graph"
    | "Unknown";
  mcpStatus: "Discoverable" | "Incomplete" | "Unknown";
  productionReady: boolean;
  rerankStatus: "AI rerank" | "Deterministic" | "Needs AI" | "Unknown";
  totalBindings: number;
  warningCount: number;
};

export type KnowledgeNode = {
  id: string;
  label: string;
  title: string;
  x?: number;
  y?: number;
  size: number;
  isSelected: boolean;
  memory: Memory;
};

export type KnowledgeLink = {
  source: KnowledgeNode;
  target: KnowledgeNode;
  relationship: string;
};

export type KnowledgeGraph = {
  nodes: KnowledgeNode[];
  links: KnowledgeLink[];
};

export type SelectedNodeRelationship = {
  direction: "incoming" | "outgoing";
  relationship: string;
  memory: Memory;
};

export type MemoryNeighborDetail = {
  direction: "incoming" | "outgoing";
  edge: GraphEdge;
  relatedMemory: Memory | null;
  relatedMemoryId: string;
};

export type GraphFilters = {
  relationship?: string;
  search: string;
  type: string;
};
