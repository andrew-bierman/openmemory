import type { GraphEdge, Memory } from "@openmemory/client";
import {
  Badge,
  Button,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openmemory/ui";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  type Updater,
  useReactTable,
} from "@tanstack/react-table";
import { Eye, Trash2 } from "lucide-react";
import {
  type ComponentType,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getKnowledgeMap,
  getRelationshipDistribution,
  getSelectedNodeRelationships,
  type KnowledgeNode,
} from "./dashboard-model";

export type MemoryTableSorting = SortingState;

export function MemoryDataTable({
  globalFilter,
  memories,
  onForget,
  onGlobalFilterChange,
  onInspect,
  onSortingChange,
  onTypeFilterChange,
  sorting,
  typeFilter,
}: Readonly<{
  globalFilter: string;
  memories: Memory[];
  onForget: (id: string) => Promise<void>;
  onGlobalFilterChange: (value: string) => void;
  onInspect: (id: string) => Promise<void>;
  onSortingChange: (updater: Updater<MemoryTableSorting>) => void;
  onTypeFilterChange: (value: string) => void;
  sorting: MemoryTableSorting;
  typeFilter: string;
}>) {
  const memoryTypes = useMemo(
    () =>
      Array.from(new Set(memories.map((memory) => memory.type))).sort(
        (left, right) => left.localeCompare(right),
      ),
    [memories],
  );
  const filteredMemories = useMemo(() => {
    if (typeFilter === "all") {
      return memories;
    }

    return memories.filter((memory) => memory.type === typeFilter);
  }, [memories, typeFilter]);
  const columns = useMemo<ColumnDef<Memory>[]>(
    () => [
      {
        accessorKey: "type",
        header: "Type",
        cell: ({ row }) => <Badge>{row.original.type}</Badge>,
      },
      {
        accessorKey: "content",
        header: "Memory",
        cell: ({ row }) => (
          <button
            className="table-memory-button"
            onClick={() => void onInspect(row.original.id)}
            type="button"
          >
            {row.original.content}
          </button>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.status}</Badge>
        ),
      },
      {
        id: "signals",
        accessorFn: (memory) => memory.tags.length + memory.entityIds.length,
        header: "Signals",
        cell: ({ getValue }) => (
          <span className="muted">{getValue<number>()}</span>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: "Updated",
        cell: ({ row }) => (
          <time dateTime={row.original.updatedAt}>
            {formatShortDate(row.original.updatedAt)}
          </time>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        header: "",
        cell: ({ row }) => (
          <div className="table-actions">
            <Button
              onClick={() => void onInspect(row.original.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Eye aria-hidden="true" />
              Inspect
            </Button>
            <Button
              onClick={() => void onForget(row.original.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trash2 aria-hidden="true" />
              Forget
            </Button>
          </div>
        ),
      },
    ],
    [onForget, onInspect],
  );
  const table = useReactTable({
    columns,
    data: filteredMemories,
    getFilteredRowModel: getFilteredRowModel(),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const needle = String(filterValue).trim().toLowerCase();
      if (!needle) {
        return true;
      }

      const memory = row.original;
      return [
        memory.content,
        memory.type,
        memory.status,
        ...memory.tags,
        ...memory.entityIds,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    },
    onGlobalFilterChange: (updater) => {
      const nextValue =
        typeof updater === "function" ? updater(globalFilter) : updater;
      onGlobalFilterChange(String(nextValue));
    },
    onSortingChange,
    state: { globalFilter, sorting },
  });

  if (memories.length === 0) {
    return (
      <div className="empty-state">
        <h3>No memories yet</h3>
        <p>
          Capture a memory or ingest a source to populate this tenant graph.
        </p>
      </div>
    );
  }

  return (
    <div className="data-table-shell">
      <div className="data-table-toolbar">
        <div>
          <strong>Memory records</strong>
          <span>
            {table.getRowModel().rows.length} of {memories.length} rows
          </span>
        </div>
        <div className="table-filters">
          <Input
            aria-label="Search memory records"
            onChange={(event) => onGlobalFilterChange(event.target.value)}
            placeholder="Filter memories"
            value={globalFilter}
          />
          <Select
            aria-label="Filter memories by type"
            onChange={(event) => onTypeFilterChange(event.target.value)}
            value={typeFilter}
          >
            <option value="all">All types</option>
            {memoryTypes.map((memoryType) => (
              <option key={memoryType} value={memoryType}>
                {memoryType}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="data-table-scroll">
        <Table className="data-table">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : (
                      <button
                        className="table-sort-button"
                        disabled={!header.column.getCanSort()}
                        onClick={header.column.getToggleSortingHandler()}
                        type="button"
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {header.column.getIsSorted() === "asc" ? " ↑" : null}
                        {header.column.getIsSorted() === "desc" ? " ↓" : null}
                      </button>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function KnowledgeMap({
  graphSearch,
  graphType,
  memories,
  neighbors,
  onGraphSearchChange,
  onGraphTypeChange,
  onInspect,
  selectedMemoryId,
}: Readonly<{
  graphSearch: string;
  graphType: string;
  memories: Memory[];
  neighbors: GraphEdge[];
  onGraphSearchChange: (value: string) => void;
  onGraphTypeChange: (value: string) => void;
  onInspect: (id: string) => Promise<void>;
  selectedMemoryId: string | null;
}>) {
  const [ForceGraph, setForceGraph] = useState<ForceGraph2DComponent | null>(
    null,
  );
  const graphRef = useRef<ForceGraph2DMethods | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [graphWidth, setGraphWidth] = useState(680);
  const memoryTypes = useMemo(
    () =>
      Array.from(new Set(memories.map((memory) => memory.type))).sort(
        (left, right) => left.localeCompare(right),
      ),
    [memories],
  );
  const graph = useMemo(
    () =>
      getKnowledgeMap(memories, neighbors, selectedMemoryId, {
        search: graphSearch,
        type: graphType,
      }),
    [graphSearch, graphType, memories, neighbors, selectedMemoryId],
  );
  const graphData = useMemo(
    () => ({
      nodes: graph.nodes.map((node) => ({
        ...node,
        x: undefined,
        y: undefined,
      })),
      links: graph.links.map((link) => ({
        source: link.source.id,
        target: link.target.id,
        relationship: link.relationship,
      })),
    }),
    [graph],
  );
  const visibleRelationshipCount = new Set(
    graph.links.map((link) => link.relationship),
  ).size;
  const relationshipDistribution = useMemo(
    () => getRelationshipDistribution(graph.links),
    [graph.links],
  );
  const selectedRelationships = useMemo(
    () => getSelectedNodeRelationships(graph),
    [graph],
  );
  const selectedNode = graph.nodes.find((node) => node.isSelected) ?? null;
  const selectedSignals = selectedNode
    ? Array.from(
        new Set([
          ...selectedNode.memory.tags,
          ...selectedNode.memory.entityIds,
        ]),
      ).slice(0, 6)
    : [];

  const fitGraph = useCallback(() => {
    if (graph.nodes.length <= 1) {
      graphRef.current?.centerAt(0, 0, 350);
      graphRef.current?.zoom(1.3, 350);
      return;
    }

    graphRef.current?.zoomToFit(350, 48);
  }, [graph.nodes.length]);

  useEffect(() => {
    let mounted = true;
    void import("react-force-graph-2d").then(({ default: ForceGraph2D }) => {
      if (mounted) {
        setForceGraph(() => ForceGraph2D as unknown as ForceGraph2DComponent);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const resize = () => {
      setGraphWidth(
        Math.max(320, Math.floor(frame.getBoundingClientRect().width)),
      );
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(frame);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const delay = graph.nodes.length > 12 || graphWidth < 480 ? 180 : 120;
    const timeout = window.setTimeout(fitGraph, delay);
    return () => window.clearTimeout(timeout);
  }, [fitGraph, graph.nodes.length, graphWidth]);

  if (graph.nodes.length === 0) {
    return (
      <section className="knowledge-map" aria-label="Knowledge map">
        <GraphExplorerControls
          graphSearch={graphSearch}
          graphType={graphType}
          memoryTypes={memoryTypes}
          onFit={fitGraph}
          onSearchChange={onGraphSearchChange}
          onTypeChange={onGraphTypeChange}
        />
        <div className="empty-map">
          <p className="muted">
            No memories match this graph filter. Clear the filter or capture new
            memories.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="knowledge-map" aria-label="Knowledge map">
      <div className="panel-heading">
        <span>Knowledge map</span>
        <strong>
          {graph.nodes.length} nodes · {visibleRelationshipCount} relationships
        </strong>
      </div>
      <GraphExplorerControls
        graphSearch={graphSearch}
        graphType={graphType}
        memoryTypes={memoryTypes}
        onFit={fitGraph}
        onSearchChange={onGraphSearchChange}
        onTypeChange={onGraphTypeChange}
      />
      <div className="graph-explorer-grid">
        <div className="force-graph-frame" ref={frameRef}>
          {ForceGraph ? (
            <ForceGraph
              cooldownTicks={80}
              ref={graphRef}
              graphData={graphData}
              height={420}
              linkColor={() => "rgba(63, 63, 70, 0.28)"}
              linkDirectionalParticles={1}
              linkDirectionalParticleSpeed={0.004}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const graphNode = node as KnowledgeNode;
                const label = truncateGraphLabel(graphNode.label);
                const radius = graphNode.size;
                const x = graphNode.x ?? 0;
                const y = graphNode.y ?? 0;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, 2 * Math.PI);
                ctx.fillStyle = graphNode.isSelected ? "#2563eb" : "#ffffff";
                ctx.fill();
                ctx.lineWidth = graphNode.isSelected ? 3 : 2;
                ctx.strokeStyle = graphNode.isSelected ? "#1d4ed8" : "#2563eb";
                ctx.stroke();
                const fontSize = 11 / globalScale;
                ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillStyle = "#3f3f46";
                ctx.fillText(label, x, y + radius + 5 / globalScale);
              }}
              nodeColor={(node) =>
                (node as KnowledgeNode).isSelected ? "#2563eb" : "#ffffff"
              }
              nodeId="id"
              nodeLabel={(node) => (node as KnowledgeNode).title}
              nodeVal={(node) => (node as KnowledgeNode).size}
              onEngineStop={fitGraph}
              onNodeClick={(node) => void onInspect((node as KnowledgeNode).id)}
              width={graphWidth}
            />
          ) : (
            <p className="muted">Loading graph explorer...</p>
          )}
        </div>
        <aside
          className="graph-inspector"
          aria-label="Graph relationship summary"
        >
          <div>
            <span>Visible graph</span>
            <strong>{graph.nodes.length}</strong>
            <small>
              {graph.links.length} links · {visibleRelationshipCount} types
            </small>
          </div>
          <div>
            <span>Selected node</span>
            <strong>{selectedNode?.memory.type ?? "None"}</strong>
            <small>{selectedNode?.label ?? "Choose a memory to inspect"}</small>
          </div>
          {selectedNode ? (
            <article
              className="selected-node-detail"
              aria-label="Selected memory graph detail"
            >
              <div>
                <Badge>{selectedNode.memory.type}</Badge>
                <time dateTime={selectedNode.memory.updatedAt}>
                  {formatShortDate(selectedNode.memory.updatedAt)}
                </time>
              </div>
              <p>{selectedNode.memory.content}</p>
              <ul aria-label="Selected memory signals">
                {selectedSignals.map((signal) => (
                  <li key={signal}>{signal}</li>
                ))}
              </ul>
            </article>
          ) : null}
          <ul
            aria-label="Visible relationship types"
            className="relationship-list"
          >
            {relationshipDistribution.length === 0 ? (
              <li className="relationship-row empty">No visible links</li>
            ) : (
              relationshipDistribution.slice(0, 5).map((relationship) => (
                <li className="relationship-row" key={relationship.label}>
                  <span>{relationship.label}</span>
                  <div aria-hidden="true">
                    <i
                      style={{
                        inlineSize: `${Math.max(8, relationship.percent)}%`,
                      }}
                    />
                  </div>
                  <strong>{relationship.count}</strong>
                </li>
              ))
            )}
          </ul>
          <ul
            aria-label="Selected memory relationships"
            className="selected-relationship-list"
          >
            {selectedRelationships.length === 0 ? (
              <li className="selected-relationship-empty">
                Select a memory to inspect direct graph relationships.
              </li>
            ) : (
              selectedRelationships.slice(0, 4).map((relationship) => (
                <li
                  className="selected-relationship-row"
                  key={`${relationship.direction}:${relationship.relationship}:${relationship.memory.id}`}
                >
                  <span>{relationship.relationship}</span>
                  <strong>{relationship.memory.type}</strong>
                  <small>
                    {relationship.direction === "incoming" ? "From" : "To"} ·{" "}
                    {getCompactMemoryText(relationship.memory.content)}
                  </small>
                </li>
              ))
            )}
          </ul>
        </aside>
      </div>
      <div className="graph-node-list">
        {graph.nodes.map((node) => (
          <button
            className={
              node.isSelected ? "graph-node-card selected" : "graph-node-card"
            }
            key={node.id}
            onClick={() => void onInspect(node.id)}
            type="button"
          >
            <span>
              <strong>{node.memory.type}</strong>
              <small>
                {node.memory.tags.slice(0, 3).join(", ") || "untagged"}
              </small>
            </span>
            <span>{node.label}</span>
          </button>
        ))}
      </div>
      <p className="muted">
        Drag nodes to explore memory neighborhoods. Lines use explicit graph
        edges when a memory is selected, then fall back to shared tags and
        entities.
      </p>
    </section>
  );
}

function GraphExplorerControls({
  graphSearch,
  graphType,
  memoryTypes,
  onFit,
  onSearchChange,
  onTypeChange,
}: Readonly<{
  graphSearch: string;
  graphType: string;
  memoryTypes: string[];
  onFit: () => void;
  onSearchChange: (value: string) => void;
  onTypeChange: (value: string) => void;
}>) {
  return (
    <div className="graph-controls">
      <Input
        aria-label="Filter graph memories"
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Filter memories, tags, or entities"
        value={graphSearch}
      />
      <Select
        aria-label="Filter graph by memory type"
        onChange={(event) => onTypeChange(event.target.value)}
        value={graphType}
      >
        <option value="all">All types</option>
        {memoryTypes.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </Select>
      <Button onClick={onFit} type="button" variant="outline">
        Fit graph
      </Button>
    </div>
  );
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function truncateGraphLabel(label: string) {
  return label.length > 22 ? `${label.slice(0, 21)}...` : label;
}

function getCompactMemoryText(content: string) {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length > 74 ? `${clean.slice(0, 73)}...` : clean;
}

type ForceGraph2DComponent = ComponentType<{
  cooldownTicks?: number;
  ref?: Ref<ForceGraph2DMethods>;
  graphData: {
    nodes: KnowledgeNode[];
    links: Array<{
      source: string;
      target: string;
      relationship: string;
    }>;
  };
  height: number;
  linkColor?: () => string;
  linkDirectionalParticles?: number;
  linkDirectionalParticleSpeed?: number;
  nodeCanvasObject?: (
    node: KnowledgeNode,
    context: CanvasRenderingContext2D,
    globalScale: number,
  ) => void;
  nodeColor?: (node: KnowledgeNode) => string;
  nodeId?: string;
  nodeLabel?: (node: KnowledgeNode) => string;
  nodeVal?: (node: KnowledgeNode) => number;
  onEngineStop?: () => void;
  onNodeClick?: (node: KnowledgeNode) => void;
  width: number;
}>;

type ForceGraph2DMethods = {
  centerAt: (x?: number, y?: number, durationMs?: number) => void;
  zoom: (zoom?: number, durationMs?: number) => void;
  zoomToFit: (durationMs?: number, padding?: number) => void;
};
