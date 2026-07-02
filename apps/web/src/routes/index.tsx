import {
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
  Button,
  Card,
  Input,
  Label,
  Select,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@openmemory/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute } from "@tanstack/react-router";
import type { Updater } from "@tanstack/react-table";
import {
  Activity,
  Brain,
  Database,
  FileText,
  GitBranch,
  KeyRound,
  Network,
  Plug,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
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
  AccountStatus,
  AdminWorkspace,
  type AuthUser,
} from "../admin-components";
import {
  KnowledgeMap,
  MemoryDataTable,
  type MemoryTableSorting,
} from "../dashboard-components";
import {
  type ActivityPoint,
  type DashboardMetrics,
  type DistributionPoint,
  getDashboardMetrics,
  getRecentActivity,
  getTypeDistribution,
} from "../dashboard-model";
import { Route as rootRoute } from "./__root";

const DEFAULT_API_URL = "http://127.0.0.1:54150";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>) => ({
    graphSearch: parseSearchTextParam(search.graphSearch),
    graphType: parseMemoryTypeParam(search.graphType),
    memoryId: parseMemoryId(search.memoryId),
    memorySearch: parseSearchTextParam(search.memorySearch),
    memorySort: parseMemorySortParam(search.memorySort),
    memoryType: parseMemoryTypeParam(search.memoryType),
    recallQuery: parseSearchTextParam(search.recallQuery),
    view: parseView(search.view),
  }),
  component: Home,
});

const VIEW_LABELS = {
  recall: "Recall",
  ingest: "Ingest",
  graph: "Knowledge Map",
  mcp: "MCP",
  admin: "Admin",
} as const;

type View = keyof typeof VIEW_LABELS;

const DEFAULT_MEMORY_SORT: MemoryTableSorting = [
  { id: "updatedAt", desc: true },
];
const MEMORY_SORT_COLUMNS = new Set([
  "content",
  "signals",
  "status",
  "type",
  "updatedAt",
]);

function Home() {
  const {
    graphSearch,
    graphType,
    memoryId,
    memorySearch,
    memorySort,
    memoryType,
    recallQuery,
    view,
  } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [apiUrl, setApiUrl, hasLoadedApiUrl] = useLocalStorage(
    "openmemory:apiUrl",
    DEFAULT_API_URL,
  );
  const [tenantId, setTenantId, hasLoadedTenantId] = useLocalStorage(
    "openmemory:tenantId",
    "local-user",
  );
  const [token, setToken, hasLoadedToken] = useLocalStorage(
    "openmemory:token",
    "",
  );
  const [email, setEmail] = useLocalStorage("openmemory:email", "");
  const [name, setName] = useLocalStorage("openmemory:name", "");
  const [password, setPassword] = useState("");
  const [content, setContent] = useState("");
  const [ingestContent, setIngestContent] = useState("");
  const [ingestSource, setIngestSource] = useState("conversation");
  const [tags, setTags] = useState("");
  const [type, setType] = useState("fact");
  const [recallDraft, setRecallDraft] = useState(
    recallQuery ?? "recent project context",
  );
  const [lastExport, setLastExport] = useState<GraphExportResult | null>(null);
  const [lastIndexRepair, setLastIndexRepair] =
    useState<IndexRepairResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usesLocalTenant = isLocalApiUrl(apiUrl);
  const hasLoadedConnection =
    hasLoadedApiUrl && hasLoadedTenantId && hasLoadedToken;
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
    enabled: hasLoadedConnection,
    queryKey: ["openmemory", "session", apiBaseUrl],
    queryFn: () => getSession(apiBaseUrl),
  });
  const memoriesQuery = useQuery({
    enabled: hasLoadedConnection,
    queryKey: ["openmemory", "memories", ...queryScope],
    queryFn: () => api.listMemories(),
  });
  const profileQuery = useQuery({
    enabled: hasLoadedConnection,
    queryKey: ["openmemory", "profile", ...queryScope],
    queryFn: () => api.getProfile(),
  });
  const graphStatsQuery = useQuery({
    enabled: hasLoadedConnection,
    queryKey: ["openmemory", "graph-stats", ...queryScope],
    queryFn: () => api.getGraphStats(),
  });
  const selectedMemoryQuery = useQuery({
    enabled: hasLoadedConnection && Boolean(memoryId),
    queryKey: ["openmemory", "memory", memoryId, ...queryScope],
    queryFn: () => api.getMemory(memoryId ?? ""),
  });
  const neighborsQuery = useQuery({
    enabled: hasLoadedConnection && Boolean(memoryId),
    queryKey: ["openmemory", "neighbors", memoryId, ...queryScope],
    queryFn: () => api.getNeighbors(memoryId ?? ""),
  });
  const oauthConnectionsQuery = useQuery({
    enabled: hasLoadedConnection,
    queryKey: ["openmemory", "oauth-connections", ...queryScope],
    queryFn: () => api.listOAuthConnections().catch(() => []),
  });
  const contextQuery = useQuery({
    enabled: hasLoadedConnection && Boolean(recallQuery),
    queryKey: ["openmemory", "context", recallQuery, ...queryScope],
    queryFn: () => api.getContext(recallQuery ?? ""),
  });
  const memories = memoriesQuery.data ?? [];
  const selectedMemory = selectedMemoryQuery.data ?? null;
  const neighbors = neighborsQuery.data ?? [];
  const graphStats = graphStatsQuery.data ?? null;
  const oauthConnections = oauthConnectionsQuery.data ?? [];
  const context = contextQuery.data ?? null;
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
  const tableGlobalFilter = memorySearch ?? "";
  const tableTypeFilter = memoryType ?? "all";
  const tableSorting = useMemo(() => parseMemorySort(memorySort), [memorySort]);
  const graphGlobalFilter = graphSearch ?? "";
  const graphTypeFilter = graphType ?? "all";

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
      queryClient.invalidateQueries({ queryKey: ["openmemory", "context"] }),
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
  useEffect(() => {
    setRecallDraft(recallQuery ?? "recent project context");
  }, [recallQuery]);
  const selectView = useCallback(
    (nextView: View) => {
      void navigate({
        to: "/",
        search: (previous) => ({
          ...previous,
          memoryId: nextView === "graph" ? previous.memoryId : undefined,
          view: nextView,
        }),
      });
    },
    [navigate],
  );
  const selectMemory = useCallback(
    (nextMemoryId: string | null) => {
      void navigate({
        to: "/",
        search: (previous) => ({
          ...previous,
          memoryId: nextMemoryId ?? undefined,
          view: "graph",
        }),
      });
    },
    [navigate],
  );
  const updateMemorySearch = useCallback(
    (nextSearch: string) => {
      void navigate({
        replace: true,
        to: "/",
        search: (previous) => ({
          ...previous,
          memoryId: undefined,
          memorySearch: nextSearch.trim() ? nextSearch : undefined,
          view: "recall",
        }),
      });
    },
    [navigate],
  );
  const updateMemoryType = useCallback(
    (nextType: string) => {
      void navigate({
        replace: true,
        to: "/",
        search: (previous) => ({
          ...previous,
          memoryId: undefined,
          memoryType: nextType === "all" ? undefined : nextType,
          view: "recall",
        }),
      });
    },
    [navigate],
  );
  const updateMemorySorting = useCallback(
    (updater: Updater<MemoryTableSorting>) => {
      const nextSorting =
        typeof updater === "function" ? updater(tableSorting) : updater;

      void navigate({
        replace: true,
        to: "/",
        search: (previous) => ({
          ...previous,
          memoryId: undefined,
          memorySort: serializeMemorySort(nextSorting),
          view: "recall",
        }),
      });
    },
    [navigate, tableSorting],
  );
  const updateGraphSearch = useCallback(
    (nextSearch: string) => {
      void navigate({
        replace: true,
        to: "/",
        search: (previous) => ({
          ...previous,
          graphSearch: nextSearch.trim() ? nextSearch : undefined,
          view: "graph",
        }),
      });
    },
    [navigate],
  );
  const updateGraphType = useCallback(
    (nextType: string) => {
      void navigate({
        replace: true,
        to: "/",
        search: (previous) => ({
          ...previous,
          graphType: nextType === "all" ? undefined : nextType,
          view: "graph",
        }),
      });
    },
    [navigate],
  );
  const submitRecallQuery = useCallback(
    (nextQuery: string) => {
      const trimmedQuery = nextQuery.trim();
      void navigate({
        to: "/",
        search: (previous) => ({
          ...previous,
          recallQuery: trimmedQuery || undefined,
          view: "recall",
        }),
      });
    },
    [navigate],
  );

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
    selectedMemoryQuery.isFetching ||
    neighborsQuery.isFetching ||
    oauthConnectionsQuery.isFetching ||
    contextQuery.isFetching ||
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
    submitRecallQuery(recallDraft);
  }

  async function ingest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await ingestSourceMutation.mutateAsync({
      content: ingestContent,
      source: ingestSource,
      tags: parseTags(tags),
    });
    setIngestContent("");
    selectMemory(result.memories[0]?.id ?? null);
  }

  async function inspectMemory(id: string) {
    selectMemory(id);
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
    queryClient.removeQueries({ queryKey: ["openmemory", "context"] });
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

  const queryError = contextQuery.error
    ? formatError(contextQuery.error)
    : null;

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

        <SidebarNav activeView={view} onSelect={selectView} />

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

        <AccountStatus
          onSignOut={signOut}
          sessionUser={sessionUser}
          tenantId={tenantId}
          usesLocalTenant={usesLocalTenant}
        />

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
          {(["recall", "ingest", "graph", "mcp", "admin"] as const).map(
            (item) => (
              <TabsTrigger
                active={view === item}
                aria-selected={view === item}
                key={item}
                onClick={() => selectView(item)}
                type="button"
              >
                {VIEW_LABELS[item]}
              </TabsTrigger>
            ),
          )}
        </TabsList>

        <form className="toolbar" onSubmit={recall}>
          <Input
            aria-label="Recall query"
            onChange={(event) => setRecallDraft(event.target.value)}
            placeholder="Ask for context"
            value={recallDraft}
          />
          <Button disabled={isLoading || !recallDraft.trim()} type="submit">
            <Send aria-hidden="true" />
            Recall
          </Button>
        </form>

        {error || queryError ? (
          <div className="error">{error ?? queryError}</div>
        ) : null}

        <div
          className={
            view === "admin" ? "workspace workspace-wide" : "workspace"
          }
        >
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
                  graphSearch={graphGlobalFilter}
                  graphType={graphTypeFilter}
                  memories={memories}
                  neighbors={neighbors}
                  onGraphSearchChange={updateGraphSearch}
                  onGraphTypeChange={updateGraphType}
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
            ) : view === "admin" ? (
              <AdminWorkspace
                apiUrl={apiUrl}
                connections={oauthConnections}
                email={email}
                isLoading={isLoading}
                name={name}
                onRevoke={revokeOAuthConnection}
                onSignIn={signIn}
                onSignOut={signOut}
                onSignUp={signUp}
                password={password}
                sessionUser={sessionUser}
                setApiUrl={setApiUrl}
                setEmail={setEmail}
                setName={setName}
                setPassword={setPassword}
                setTenantId={setTenantId}
                setToken={setToken}
                tenantId={tenantId}
                token={token}
                usesLocalTenant={usesLocalTenant}
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
                  globalFilter={tableGlobalFilter}
                  memories={memories}
                  onForget={forget}
                  onGlobalFilterChange={updateMemorySearch}
                  onInspect={inspectMemory}
                  onSortingChange={updateMemorySorting}
                  onTypeFilterChange={updateMemoryType}
                  sorting={tableSorting}
                  typeFilter={tableTypeFilter}
                />
              </>
            )}
          </div>

          {view === "admin" ? null : (
            <div className="stack">
              <div className="panel">
                <div className="panel-title compact">
                  <h2>Context</h2>
                </div>
                <pre className="context">
                  {contextQuery.isFetching
                    ? "Assembling graph context..."
                    : context?.context ||
                      "Run recall to assemble graph context."}
                </pre>
              </div>
              <div className="panel">
                <div className="panel-title compact">
                  <h2>Profile</h2>
                </div>
                <pre className="context">{profile || "No profile yet."}</pre>
              </div>
            </div>
          )}
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
      view: "admin",
      label: "Admin",
      description: "Account, tenants, and access",
      icon: <ShieldCheck aria-hidden="true" />,
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
  const authServerMetadataUrl = `${baseUrl}/.well-known/oauth-authorization-server/api/auth`;
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
            authorizationServer: authServerMetadataUrl,
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

  return [value, setValue, hasLoaded] as const;
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

function parseView(value: unknown): View {
  return typeof value === "string" && value in VIEW_LABELS
    ? (value as View)
    : "recall";
}

function parseMemoryId(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseSearchTextParam(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseMemoryTypeParam(value: unknown) {
  return typeof value === "string" && value.trim() && value !== "all"
    ? value
    : undefined;
}

function parseMemorySortParam(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const [columnId, direction] = value.split(".");
  if (
    columnId &&
    MEMORY_SORT_COLUMNS.has(columnId) &&
    (direction === "asc" || direction === "desc")
  ) {
    return `${columnId}.${direction}`;
  }

  return undefined;
}

function parseMemorySort(value: string | undefined): MemoryTableSorting {
  const parsed = parseMemorySortParam(value);
  if (!parsed) {
    return [...DEFAULT_MEMORY_SORT];
  }

  const [columnId, direction] = parsed.split(".");
  return [{ id: columnId, desc: direction === "desc" }];
}

function serializeMemorySort(sorting: MemoryTableSorting) {
  const [firstSort] = sorting;
  if (!firstSort || !MEMORY_SORT_COLUMNS.has(firstSort.id)) {
    return undefined;
  }

  if (firstSort.id === "updatedAt" && firstSort.desc) {
    return undefined;
  }

  return `${firstSort.id}.${firstSort.desc ? "desc" : "asc"}`;
}
