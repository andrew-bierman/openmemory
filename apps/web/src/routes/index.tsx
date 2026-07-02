import {
  type ContextResult,
  createOpenMemoryClient,
  type GraphEdge,
  type GraphExportResult,
  type GraphStats,
  type IndexRepairResult,
  type Memory,
  type OAuthConnection,
  OpenMemoryApiError,
} from "@openmemory/client";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@openmemory/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute } from "@tanstack/react-router";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  Activity,
  Brain,
  Database,
  Eye,
  FileText,
  GitBranch,
  KeyRound,
  Network,
  Plug,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import {
  type ComponentType,
  type FormEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ActivityPoint,
  type DashboardMetrics,
  type DistributionPoint,
  getDashboardMetrics,
  getKnowledgeMap,
  getRecentActivity,
  getTypeDistribution,
  type KnowledgeNode,
} from "../dashboard-model";
import { Route as rootRoute } from "./__root";

const DEFAULT_API_URL = "http://127.0.0.1:54150";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});

const VIEW_LABELS = {
  recall: "Recall",
  ingest: "Ingest",
  graph: "Knowledge Map",
  mcp: "MCP",
} as const;

type View = keyof typeof VIEW_LABELS;

function Home() {
  const [apiUrl, setApiUrl] = useLocalStorage(
    "openmemory:apiUrl",
    DEFAULT_API_URL,
  );
  const [tenantId, setTenantId] = useLocalStorage(
    "openmemory:tenantId",
    "local-user",
  );
  const [token, setToken] = useLocalStorage("openmemory:token", "");
  const [email, setEmail] = useLocalStorage("openmemory:email", "");
  const [name, setName] = useLocalStorage("openmemory:name", "");
  const [password, setPassword] = useState("");
  const [content, setContent] = useState("");
  const [ingestContent, setIngestContent] = useState("");
  const [ingestSource, setIngestSource] = useState("conversation");
  const [tags, setTags] = useState("");
  const [type, setType] = useState("fact");
  const [query, setQuery] = useState("recent project context");
  const [context, setContext] = useState<ContextResult | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [neighbors, setNeighbors] = useState<GraphEdge[]>([]);
  const [lastExport, setLastExport] = useState<GraphExportResult | null>(null);
  const [lastIndexRepair, setLastIndexRepair] =
    useState<IndexRepairResult | null>(null);
  const [view, setView] = useState<View>("recall");
  const [error, setError] = useState<string | null>(null);
  const usesLocalTenant = isLocalApiUrl(apiUrl);
  const queryClient = useQueryClient();
  const apiBaseUrl = cleanBaseUrl(apiUrl);
  const queryScope = useMemo(
    () => [apiBaseUrl, usesLocalTenant ? tenantId : "session", token] as const,
    [apiBaseUrl, tenantId, token, usesLocalTenant],
  );

  const api = useMemo(
    () =>
      createOpenMemoryClient(apiBaseUrl, {
        tenantId: usesLocalTenant ? tenantId : undefined,
        token: token || undefined,
        credentials: "include",
      }),
    [apiBaseUrl, tenantId, token, usesLocalTenant],
  );
  const sessionQuery = useQuery({
    queryKey: ["openmemory", "session", apiBaseUrl],
    queryFn: () => getSession(apiBaseUrl),
  });
  const memoriesQuery = useQuery({
    queryKey: ["openmemory", "memories", ...queryScope],
    queryFn: () => api.listMemories(),
  });
  const profileQuery = useQuery({
    queryKey: ["openmemory", "profile", ...queryScope],
    queryFn: () => api.getProfile(),
  });
  const graphStatsQuery = useQuery({
    queryKey: ["openmemory", "graph-stats", ...queryScope],
    queryFn: () => api.getGraphStats(),
  });
  const oauthConnectionsQuery = useQuery({
    queryKey: ["openmemory", "oauth-connections", ...queryScope],
    queryFn: () => api.listOAuthConnections().catch(() => []),
  });
  const memories = memoriesQuery.data ?? [];
  const graphStats = graphStatsQuery.data ?? null;
  const oauthConnections = oauthConnectionsQuery.data ?? [];
  const profile = profileQuery.data?.summary ?? "";
  const sessionUser = sessionQuery.data ?? null;
  const dashboardMetrics = useMemo(
    () => getDashboardMetrics(memories, graphStats, oauthConnections),
    [memories, graphStats, oauthConnections],
  );
  const recentActivity = useMemo(() => getRecentActivity(memories), [memories]);
  const typeDistribution = useMemo(
    () => getTypeDistribution(memories),
    [memories],
  );

  const invalidateDashboard = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["openmemory", "memories"] }),
      queryClient.invalidateQueries({ queryKey: ["openmemory", "profile"] }),
      queryClient.invalidateQueries({
        queryKey: ["openmemory", "graph-stats"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["openmemory", "oauth-connections"],
      }),
      queryClient.invalidateQueries({ queryKey: ["openmemory", "session"] }),
    ]);
  }, [queryClient]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(formatError(caught));
    }
  }, []);

  const refresh = useCallback(async () => {
    await run(invalidateDashboard);
  }, [invalidateDashboard, run]);

  const createMemoryMutation = useMutation({
    mutationFn: api.createMemory,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: invalidateDashboard,
  });
  const ingestSourceMutation = useMutation({
    mutationFn: api.ingestSource,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: invalidateDashboard,
  });
  const forgetMemoryMutation = useMutation({
    mutationFn: api.forgetMemory,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: invalidateDashboard,
  });
  const authMutation = useMutation({
    mutationFn: ({
      path,
      body,
    }: {
      path: string;
      body: Record<string, unknown>;
    }) => authRequest(apiBaseUrl, path, body),
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: invalidateDashboard,
  });
  const revokeOAuthMutation = useMutation({
    mutationFn: api.revokeOAuthConnection,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: invalidateDashboard,
  });
  const exportGraphMutation = useMutation({
    mutationFn: api.exportGraph,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: (result) => setLastExport(result),
  });
  const repairIndexMutation = useMutation({
    mutationFn: api.repairIndex,
    onError: (caught) => setError(formatError(caught)),
    onMutate: () => setError(null),
    onSuccess: (result) => setLastIndexRepair(result),
  });
  const isLoading =
    sessionQuery.isFetching ||
    memoriesQuery.isFetching ||
    profileQuery.isFetching ||
    graphStatsQuery.isFetching ||
    oauthConnectionsQuery.isFetching ||
    createMemoryMutation.isPending ||
    ingestSourceMutation.isPending ||
    forgetMemoryMutation.isPending ||
    authMutation.isPending ||
    revokeOAuthMutation.isPending ||
    exportGraphMutation.isPending ||
    repairIndexMutation.isPending;

  async function remember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await createMemoryMutation.mutateAsync({
      content,
      type,
      tags: parseTags(tags),
    });
    setContent("");
    setTags("");
  }

  async function recall(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    await run(async () => {
      setContext(await api.getContext(query));
    });
  }

  async function ingest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await ingestSourceMutation.mutateAsync({
      content: ingestContent,
      source: ingestSource,
      tags: parseTags(tags),
    });
    setIngestContent("");
    setSelectedMemory(result.memories[0] ?? null);
    setNeighbors(result.edges);
    setView("graph");
  }

  async function inspectMemory(id: string) {
    await run(async () => {
      const [memory, nextNeighbors] = await Promise.all([
        api.getMemory(id),
        api.getNeighbors(id),
      ]);
      setSelectedMemory(memory);
      setNeighbors(nextNeighbors);
      setView("graph");
    });
  }

  async function forget(id: string) {
    await forgetMemoryMutation.mutateAsync(id);
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await authMutation.mutateAsync({
      path: "/api/auth/sign-in/email",
      body: {
        email,
        password,
        rememberMe: true,
      },
    });
    setPassword("");
  }

  async function signUp() {
    await authMutation.mutateAsync({
      path: "/api/auth/sign-up/email",
      body: {
        email,
        password,
        name: name || email,
      },
    });
    setPassword("");
  }

  async function signOut() {
    await authMutation.mutateAsync({
      path: "/api/auth/sign-out",
      body: {},
    });
    queryClient.setQueryData(["openmemory", "session", apiBaseUrl], null);
    queryClient.setQueryData(["openmemory", "memories", ...queryScope], []);
    queryClient.setQueryData(["openmemory", "profile", ...queryScope], {
      summary: "",
    });
    queryClient.setQueryData(
      ["openmemory", "oauth-connections", ...queryScope],
      [],
    );
    setContext(null);
  }

  async function revokeOAuthConnection(clientId: string) {
    await revokeOAuthMutation.mutateAsync(clientId);
  }

  async function exportGraph() {
    await exportGraphMutation.mutateAsync();
  }

  async function repairIndex() {
    await repairIndexMutation.mutateAsync();
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            OM
          </div>
          <div>
            <h1>OpenMemory</h1>
            <p>Hosted graph memory for AI tools.</p>
          </div>
        </div>

        <SidebarNav activeView={view} onSelect={setView} />

        <Card className="sidebar-section">
          <div className="section-label">Connection</div>
          <div className="field">
            <Label htmlFor="apiUrl">API URL</Label>
            <Input
              id="apiUrl"
              onChange={(event) => setApiUrl(event.target.value)}
              value={apiUrl}
            />
          </div>
          <div className="field">
            <Label htmlFor="tenant">Tenant</Label>
            <Input
              disabled={!usesLocalTenant}
              id="tenant"
              onChange={(event) => setTenantId(event.target.value)}
              value={tenantId}
            />
          </div>
          <div className="field">
            <Label htmlFor="token">Bearer token</Label>
            <Input
              id="token"
              onChange={(event) => setToken(event.target.value)}
              placeholder="Optional"
              type="password"
              value={token}
            />
          </div>
        </Card>

        <Card className="sidebar-section">
          <form className="stack" onSubmit={signIn}>
            <div className="section-label">Account</div>
            <div className="session-row">
              <strong>
                {sessionUser ? sessionUser.email : "Not signed in"}
              </strong>
              {sessionUser ? (
                <Button onClick={() => void signOut()} size="sm" type="button">
                  Sign out
                </Button>
              ) : null}
            </div>
            <div className="field">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </div>
            <div className="field">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                value={email}
              />
            </div>
            <div className="field">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </div>
            <div className="row">
              <Button disabled={isLoading || !email || !password} type="submit">
                Sign in
              </Button>
              <Button
                disabled={isLoading || !email || !password}
                onClick={() => void signUp()}
                type="button"
                variant="outline"
              >
                Create account
              </Button>
            </div>
          </form>
        </Card>

        <Card className="sidebar-section capture-section">
          <form className="stack" onSubmit={remember}>
            <div className="section-label">Capture</div>
            <div className="field">
              <Label htmlFor="content">Memory</Label>
              <Textarea
                id="content"
                onChange={(event) => setContent(event.target.value)}
                placeholder="Save a fact, preference, decision, episode, or insight."
                required
                value={content}
              />
            </div>
            <div className="row">
              <div className="field">
                <Label htmlFor="type">Type</Label>
                <Select
                  id="type"
                  onChange={(event) => setType(event.target.value)}
                  value={type}
                >
                  <option value="fact">Fact</option>
                  <option value="preference">Preference</option>
                  <option value="decision">Decision</option>
                  <option value="episode">Episode</option>
                  <option value="insight">Insight</option>
                  <option value="profile">Profile</option>
                </Select>
              </div>
              <div className="field">
                <Label htmlFor="tags">Tags</Label>
                <Input
                  id="tags"
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="work, project"
                  value={tags}
                />
              </div>
            </div>
            <Button disabled={isLoading || !content.trim()} type="submit">
              Remember
            </Button>
          </form>
        </Card>
      </aside>

      <section className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">OpenMemory Control Plane</p>
            <h2>Memory Dashboard</h2>
            <p>
              Inspect graph health, capture context, and manage the MCP surface
              that feeds external AI tools.
            </p>
          </div>
          <div className="header-actions">
            <div className="runtime-pill">
              <span>{usesLocalTenant ? "Local worker" : "Hosted worker"}</span>
              <strong>{sessionUser ? sessionUser.email : tenantId}</strong>
            </div>
            <Button
              disabled={isLoading}
              onClick={() => void refresh()}
              type="button"
            >
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </header>

        <DashboardOverview
          metrics={dashboardMetrics}
          recentActivity={recentActivity}
          typeDistribution={typeDistribution}
        />

        <TabsList aria-label="Workspace views" className="tabs">
          {(["recall", "ingest", "graph", "mcp"] as const).map((item) => (
            <TabsTrigger
              active={view === item}
              key={item}
              onClick={() => setView(item)}
              type="button"
            >
              {VIEW_LABELS[item]}
            </TabsTrigger>
          ))}
        </TabsList>

        <form className="toolbar" onSubmit={recall}>
          <Input
            aria-label="Recall query"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ask for context"
            value={query}
          />
          <Button disabled={isLoading || !query.trim()} type="submit">
            <Send aria-hidden="true" />
            Recall
          </Button>
        </form>

        {error ? <div className="error">{error}</div> : null}

        <div className="workspace">
          <div className="panel">
            {view === "ingest" ? (
              <form className="stack" onSubmit={ingest}>
                <div className="panel-title">
                  <div>
                    <p className="eyebrow">Pipeline</p>
                    <h2>Ingest Source</h2>
                  </div>
                </div>
                <div className="field">
                  <Label htmlFor="ingestSource">Source</Label>
                  <Input
                    id="ingestSource"
                    onChange={(event) => setIngestSource(event.target.value)}
                    value={ingestSource}
                  />
                </div>
                <div className="field">
                  <Label htmlFor="ingestContent">Content</Label>
                  <Textarea
                    id="ingestContent"
                    onChange={(event) => setIngestContent(event.target.value)}
                    required
                    value={ingestContent}
                  />
                </div>
                <Button
                  disabled={isLoading || !ingestContent.trim()}
                  type="submit"
                >
                  Ingest
                </Button>
              </form>
            ) : view === "graph" ? (
              <div className="stack">
                <div className="panel-title">
                  <div>
                    <p className="eyebrow">Graph</p>
                    <h2>Knowledge Map</h2>
                  </div>
                </div>
                <GraphStatsPanel stats={graphStats} />
                <KnowledgeMap
                  memories={memories}
                  neighbors={neighbors}
                  onInspect={inspectMemory}
                  selectedMemoryId={selectedMemory?.id ?? null}
                />
                <div className="row">
                  <Button
                    disabled={isLoading}
                    onClick={() => void exportGraph()}
                    type="button"
                    variant="outline"
                  >
                    Export
                  </Button>
                  <Button
                    disabled={isLoading}
                    onClick={() => void repairIndex()}
                    type="button"
                    variant="outline"
                  >
                    Repair index
                  </Button>
                  {lastExport ? (
                    <span className="muted">
                      {lastExport.memoryCount} memories exported
                    </span>
                  ) : null}
                  {lastIndexRepair ? (
                    <span className="muted">
                      {lastIndexRepair.attempted} memories queued
                    </span>
                  ) : null}
                </div>
                <MemoryDetail
                  memory={selectedMemory}
                  neighbors={neighbors}
                  onForget={forget}
                />
              </div>
            ) : view === "mcp" ? (
              <McpSetup
                apiUrl={apiUrl}
                connections={oauthConnections}
                onRevoke={revokeOAuthConnection}
              />
            ) : (
              <>
                <div className="panel-title">
                  <div>
                    <p className="eyebrow">Recall</p>
                    <h2>Memories</h2>
                  </div>
                </div>
                <MemoryDataTable
                  memories={memories}
                  onForget={forget}
                  onInspect={inspectMemory}
                />
              </>
            )}
          </div>

          <div className="stack">
            <div className="panel">
              <div className="panel-title compact">
                <h2>Context</h2>
              </div>
              <pre className="context">
                {context?.context || "Run recall to assemble graph context."}
              </pre>
            </div>
            <div className="panel">
              <div className="panel-title compact">
                <h2>Profile</h2>
              </div>
              <pre className="context">{profile || "No profile yet."}</pre>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function SidebarNav({
  activeView,
  onSelect,
}: Readonly<{
  activeView: View;
  onSelect: (view: View) => void;
}>) {
  const items: Array<{
    view: View;
    label: string;
    description: string;
    icon: ReactNode;
  }> = [
    {
      view: "recall",
      label: "Dashboard",
      description: "Memories and recall context",
      icon: <Database aria-hidden="true" />,
    },
    {
      view: "ingest",
      label: "Sources",
      description: "Documents and long-form context",
      icon: <FileText aria-hidden="true" />,
    },
    {
      view: "graph",
      label: "Knowledge Map",
      description: "Graph inspection and repair",
      icon: <Network aria-hidden="true" />,
    },
    {
      view: "mcp",
      label: "MCP",
      description: "Client setup and connections",
      icon: <Plug aria-hidden="true" />,
    },
  ];

  return (
    <nav aria-label="Main navigation" className="sidebar-nav">
      <div className="section-label">Workspace</div>
      {items.map((item) => (
        <button
          className={activeView === item.view ? "nav-item active" : "nav-item"}
          key={item.view}
          onClick={() => onSelect(item.view)}
          type="button"
        >
          {item.icon}
          <span>
            <strong>{item.label}</strong>
            <small>{item.description}</small>
          </span>
        </button>
      ))}
    </nav>
  );
}

function DashboardOverview({
  metrics,
  recentActivity,
  typeDistribution,
}: Readonly<{
  metrics: DashboardMetrics;
  recentActivity: ActivityPoint[];
  typeDistribution: DistributionPoint[];
}>) {
  return (
    <section className="overview-grid" aria-label="Memory overview">
      <div className="metric-tile featured">
        <Activity aria-hidden="true" />
        <span>Active memories</span>
        <strong>{metrics.activeMemories}</strong>
        <small>{metrics.totalMemories} total graph nodes</small>
      </div>
      <div className="metric-tile">
        <GitBranch aria-hidden="true" />
        <span>Edges</span>
        <strong>{metrics.totalEdges}</strong>
        <small>{metrics.relationshipCount} relationship types</small>
      </div>
      <div className="metric-tile">
        <Brain aria-hidden="true" />
        <span>Entities</span>
        <strong>{metrics.entityCount}</strong>
        <small>{metrics.tagCount} tags indexed</small>
      </div>
      <div className="metric-tile">
        <KeyRound aria-hidden="true" />
        <span>MCP clients</span>
        <strong>{metrics.oauthConnections}</strong>
        <small>{metrics.recalledMemories} recalled in context</small>
      </div>
      <div className="chart-panel activity-panel">
        <div className="panel-heading">
          <span>Capture cadence</span>
          <strong>Last 7 days</strong>
        </div>
        <div
          className="chart-frame"
          role="img"
          aria-label="Memory capture activity"
        >
          <ResponsiveContainer height={150} width="100%">
            <BarChart data={recentActivity} margin={{ left: 0, right: 6 }}>
              <CartesianGrid stroke="#e4e4e7" vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="label"
                tickLine={false}
                tickMargin={8}
              />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: "rgba(37, 99, 235, 0.08)" }}
                formatter={(value) => [value, "Memories"]}
              />
              <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 2, 2]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="chart-panel type-panel">
        <div className="panel-heading">
          <span>Memory mix</span>
          <strong>{typeDistribution.length} types</strong>
        </div>
        <div className="chart-frame">
          {typeDistribution.length === 0 ? (
            <p className="muted">No typed memories yet.</p>
          ) : (
            <ResponsiveContainer height={150} width="100%">
              <BarChart
                data={typeDistribution}
                layout="vertical"
                margin={{ bottom: 0, left: 10, right: 12, top: 0 }}
              >
                <CartesianGrid horizontal={false} stroke="#e4e4e7" />
                <XAxis allowDecimals={false} axisLine={false} type="number" />
                <YAxis
                  axisLine={false}
                  dataKey="label"
                  tickLine={false}
                  type="category"
                  width={92}
                />
                <Tooltip
                  cursor={{ fill: "rgba(15, 118, 110, 0.08)" }}
                  formatter={(value) => [value, "Memories"]}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                  {typeDistribution.map((point, index) => (
                    <Cell
                      fill={index % 2 === 0 ? "#2563eb" : "#0f766e"}
                      key={point.label}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </section>
  );
}

function MemoryDataTable({
  memories,
  onForget,
  onInspect,
}: Readonly<{
  memories: Memory[];
  onForget: (id: string) => Promise<void>;
  onInspect: (id: string) => Promise<void>;
}>) {
  const [globalFilter, setGlobalFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "updatedAt", desc: true },
  ]);
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
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
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
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder="Filter memories"
            value={globalFilter}
          />
          <Select
            aria-label="Filter memories by type"
            onChange={(event) => setTypeFilter(event.target.value)}
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

function KnowledgeMap({
  memories,
  neighbors,
  selectedMemoryId,
  onInspect,
}: Readonly<{
  memories: Memory[];
  neighbors: GraphEdge[];
  selectedMemoryId: string | null;
  onInspect: (id: string) => Promise<void>;
}>) {
  const [ForceGraph, setForceGraph] = useState<ForceGraph2DComponent | null>(
    null,
  );
  const [graphSearch, setGraphSearch] = useState("");
  const [graphType, setGraphType] = useState("all");
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

  const fitGraph = useCallback(() => {
    graphRef.current?.zoomToFit(350, 48);
  }, []);

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
          onSearchChange={setGraphSearch}
          onTypeChange={setGraphType}
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
        onSearchChange={setGraphSearch}
        onTypeChange={setGraphType}
      />
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
              const label = graphNode.label;
              const radius = graphNode.size;
              ctx.beginPath();
              ctx.arc(
                graphNode.x ?? 0,
                graphNode.y ?? 0,
                radius,
                0,
                2 * Math.PI,
              );
              ctx.fillStyle = graphNode.isSelected ? "#2563eb" : "#ffffff";
              ctx.fill();
              ctx.lineWidth = graphNode.isSelected ? 3 : 2;
              ctx.strokeStyle = graphNode.isSelected ? "#1d4ed8" : "#2563eb";
              ctx.stroke();
              const fontSize = Math.min(11, Math.max(7, 10 / globalScale));
              ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillStyle = "#3f3f46";
              ctx.fillText(
                label,
                graphNode.x ?? 0,
                (graphNode.y ?? 0) + radius + 4,
              );
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

function MemoryDetail({
  memory,
  neighbors,
  onForget,
}: Readonly<{
  memory: Memory | null;
  neighbors: GraphEdge[];
  onForget: (id: string) => Promise<void>;
}>) {
  if (!memory) {
    return <p className="muted">Select a memory to inspect its graph.</p>;
  }

  return (
    <div className="stack">
      <h2>Memory Detail</h2>
      <article className="memory">
        <p>{memory.content}</p>
        <MemoryMeta memory={memory} />
        <Button
          onClick={() => void onForget(memory.id)}
          size="sm"
          type="button"
          variant="outline"
        >
          Forget
        </Button>
      </article>
      <h2>Neighbors</h2>
      {neighbors.length === 0 ? (
        <p className="muted">No graph neighbors yet.</p>
      ) : (
        <div className="memory-list">
          {neighbors.map((edge) => (
            <article
              className="memory compact"
              key={`${edge.sourceId}:${edge.relationship}:${edge.targetId}`}
            >
              <div className="meta">
                <span className="pill">{edge.relationship}</span>
                <span>{edge.weight.toFixed(2)}</span>
              </div>
              <pre className="context">
                {`${edge.sourceId} -> ${edge.targetId}`}
              </pre>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function GraphStatsPanel({ stats }: Readonly<{ stats: GraphStats | null }>) {
  if (!stats) {
    return <p className="muted">Graph stats unavailable.</p>;
  }

  return (
    <div className="stats-grid">
      <Stat label="Active" value={stats.activeMemories} />
      <Stat label="Historical" value={stats.historicalMemories} />
      <Stat label="Edges" value={stats.totalEdges} />
      <Stat label="Entities" value={stats.entityCount} />
    </div>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MemoryMeta({ memory }: Readonly<{ memory: Memory }>) {
  return (
    <div className="meta">
      <span className="pill">{memory.type}</span>
      <span className="pill">{memory.status}</span>
      {memory.tags.map((tag) => (
        <span className="pill" key={tag}>
          {tag}
        </span>
      ))}
      {memory.entityIds.map((entityId) => (
        <span className="pill" key={entityId}>
          {entityId}
        </span>
      ))}
    </div>
  );
}

function McpSetup({
  apiUrl,
  connections,
  onRevoke,
}: Readonly<{
  apiUrl: string;
  connections: OAuthConnection[];
  onRevoke: (clientId: string) => Promise<void>;
}>) {
  const baseUrl = cleanBaseUrl(apiUrl);
  return (
    <div className="stack">
      <h2>MCP</h2>
      <div className="field">
        <label htmlFor="mcpUrl">Server URL</label>
        <input id="mcpUrl" readOnly value={`${baseUrl}/mcp`} />
      </div>
      <div className="field">
        <label htmlFor="issuer">OAuth issuer</label>
        <input id="issuer" readOnly value={`${baseUrl}/api/auth`} />
      </div>
      <pre className="context">
        {JSON.stringify(
          {
            transport: "streamable-http",
            url: `${baseUrl}/mcp`,
            authorizationServer: `${baseUrl}/.well-known/oauth-authorization-server`,
            scopes: ["openid", "profile", "memory:read", "memory:write"],
          },
          null,
          2,
        )}
      </pre>
      <h2>Connections</h2>
      {connections.length === 0 ? (
        <p className="muted">No OAuth MCP clients have been authorized.</p>
      ) : (
        <div className="memory-list">
          {connections.map((connection) => (
            <article className="memory compact" key={connection.clientId}>
              <div className="meta">
                <span className="pill">{connection.name}</span>
                {connection.scopes.map((scope) => (
                  <span className="pill" key={scope}>
                    {scope}
                  </span>
                ))}
              </div>
              <pre className="context">{connection.clientId}</pre>
              <Button
                onClick={() => void onRevoke(connection.clientId)}
                size="sm"
                type="button"
                variant="outline"
              >
                Revoke
              </Button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
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

function useLocalStorage(key: string, initialValue: string) {
  const [value, setValue] = useState(initialValue);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    setValue(window.localStorage.getItem(key) ?? initialValue);
    setHasLoaded(true);
  }, [initialValue, key]);

  useEffect(() => {
    if (!hasLoaded) {
      return;
    }

    window.localStorage.setItem(key, value);
  }, [hasLoaded, key, value]);

  return [value, setValue] as const;
}

function formatError(error: unknown) {
  if (error instanceof OpenMemoryApiError) {
    return `${error.status}: ${error.message}`;
  }

  return error instanceof Error ? error.message : "Unexpected error";
}

async function getSession(apiUrl: string) {
  const response = await fetch(`${cleanBaseUrl(apiUrl)}/api/auth/get-session`, {
    credentials: "include",
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { user?: AuthUser } | null;
  return data?.user ?? null;
}

async function authRequest(
  apiUrl: string,
  path: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${cleanBaseUrl(apiUrl)}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

function cleanBaseUrl(apiUrl: string) {
  return apiUrl.replace(/\/+$/, "");
}

function isLocalApiUrl(apiUrl: string) {
  try {
    const hostname = new URL(apiUrl).hostname;
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

type AuthUser = {
  id: string;
  email: string;
  name?: string;
};

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
  zoomToFit: (durationMs?: number, padding?: number) => void;
};
