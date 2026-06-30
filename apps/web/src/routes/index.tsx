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
import { Button } from "@openmemory/ui";
import { createRoute } from "@tanstack/react-router";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
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
  const [memories, setMemories] = useState<Memory[]>([]);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [neighbors, setNeighbors] = useState<GraphEdge[]>([]);
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);
  const [lastExport, setLastExport] = useState<GraphExportResult | null>(null);
  const [lastIndexRepair, setLastIndexRepair] =
    useState<IndexRepairResult | null>(null);
  const [oauthConnections, setOauthConnections] = useState<OAuthConnection[]>(
    [],
  );
  const [profile, setProfile] = useState("");
  const [view, setView] = useState<"recall" | "ingest" | "graph" | "mcp">(
    "recall",
  );
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const usesLocalTenant = isLocalApiUrl(apiUrl);

  const api = useMemo(
    () =>
      createOpenMemoryClient(apiUrl.replace(/\/+$/, ""), {
        tenantId: usesLocalTenant ? tenantId : undefined,
        token: token || undefined,
        credentials: "include",
      }),
    [apiUrl, tenantId, token, usesLocalTenant],
  );
  const dashboardMetrics = useMemo(
    () => getDashboardMetrics(memories, graphStats, oauthConnections),
    [memories, graphStats, oauthConnections],
  );
  const recentActivity = useMemo(() => getRecentActivity(memories), [memories]);
  const typeDistribution = useMemo(
    () => getTypeDistribution(memories),
    [memories],
  );

  const run = useCallback(async (action: () => Promise<void>) => {
    setIsLoading(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(formatError(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await run(async () => {
      const [
        nextSession,
        nextMemories,
        nextProfile,
        nextGraphStats,
        nextOAuthConnections,
      ] = await Promise.all([
        getSession(apiUrl),
        api.listMemories(),
        api.getProfile(),
        api.getGraphStats(),
        api.listOAuthConnections().catch(() => []),
      ]);
      setSessionUser(nextSession);
      setMemories(nextMemories);
      setProfile(nextProfile.summary);
      setGraphStats(nextGraphStats);
      setOauthConnections(nextOAuthConnections);
    });
  }, [api, apiUrl, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function remember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await api.createMemory({
        content,
        type,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setContent("");
      setTags("");
      await refresh();
    });
  }

  async function recall(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    await run(async () => {
      setContext(await api.getContext(query));
    });
  }

  async function ingest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const result = await api.ingestSource({
        content: ingestContent,
        source: ingestSource,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setIngestContent("");
      setSelectedMemory(result.memories[0] ?? null);
      setNeighbors(result.edges);
      setView("graph");
      await refresh();
    });
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
    await run(async () => {
      await api.forgetMemory(id);
      await refresh();
    });
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await authRequest(apiUrl, "/api/auth/sign-in/email", {
        email,
        password,
        rememberMe: true,
      });
      setPassword("");
      await refresh();
    });
  }

  async function signUp() {
    await run(async () => {
      await authRequest(apiUrl, "/api/auth/sign-up/email", {
        email,
        password,
        name: name || email,
      });
      setPassword("");
      await refresh();
    });
  }

  async function signOut() {
    await run(async () => {
      await authRequest(apiUrl, "/api/auth/sign-out", {});
      setSessionUser(null);
      setMemories([]);
      setProfile("");
      setContext(null);
      setOauthConnections([]);
    });
  }

  async function revokeOAuthConnection(clientId: string) {
    await run(async () => {
      await api.revokeOAuthConnection(clientId);
      setOauthConnections(await api.listOAuthConnections().catch(() => []));
    });
  }

  async function exportGraph() {
    await run(async () => {
      setLastExport(await api.exportGraph());
    });
  }

  async function repairIndex() {
    await run(async () => {
      setLastIndexRepair(await api.repairIndex());
    });
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

        <section className="sidebar-section">
          <div className="section-label">Connection</div>
          <div className="field">
            <label htmlFor="apiUrl">API URL</label>
            <input
              id="apiUrl"
              onChange={(event) => setApiUrl(event.target.value)}
              value={apiUrl}
            />
          </div>
          <div className="field">
            <label htmlFor="tenant">Tenant</label>
            <input
              disabled={!usesLocalTenant}
              id="tenant"
              onChange={(event) => setTenantId(event.target.value)}
              value={tenantId}
            />
          </div>
          <div className="field">
            <label htmlFor="token">Bearer token</label>
            <input
              id="token"
              onChange={(event) => setToken(event.target.value)}
              placeholder="Optional"
              type="password"
              value={token}
            />
          </div>
        </section>

        <form className="sidebar-section" onSubmit={signIn}>
          <div className="section-label">Account</div>
          <div className="session-row">
            <strong>{sessionUser ? sessionUser.email : "Not signed in"}</strong>
            {sessionUser ? (
              <Button onClick={() => void signOut()} size="sm" type="button">
                Sign out
              </Button>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
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

        <form className="sidebar-section capture-section" onSubmit={remember}>
          <div className="section-label">Capture</div>
          <div className="field">
            <label htmlFor="content">Memory</label>
            <textarea
              id="content"
              onChange={(event) => setContent(event.target.value)}
              placeholder="Save a fact, preference, decision, episode, or insight."
              required
              value={content}
            />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="type">Type</label>
              <select
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
              </select>
            </div>
            <div className="field">
              <label htmlFor="tags">Tags</label>
              <input
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
              Refresh
            </Button>
          </div>
        </header>

        <DashboardOverview
          metrics={dashboardMetrics}
          recentActivity={recentActivity}
          typeDistribution={typeDistribution}
        />

        <nav aria-label="Workspace views" className="tabs segmented-control">
          {(["recall", "ingest", "graph", "mcp"] as const).map((item) => (
            <Button
              key={item}
              onClick={() => setView(item)}
              type="button"
              variant={view === item ? "default" : "outline"}
            >
              {VIEW_LABELS[item]}
            </Button>
          ))}
        </nav>

        <form className="toolbar" onSubmit={recall}>
          <input
            aria-label="Recall query"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ask for context"
            value={query}
          />
          <Button disabled={isLoading || !query.trim()} type="submit">
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
                  <label htmlFor="ingestSource">Source</label>
                  <input
                    id="ingestSource"
                    onChange={(event) => setIngestSource(event.target.value)}
                    value={ingestSource}
                  />
                </div>
                <div className="field">
                  <label htmlFor="ingestContent">Content</label>
                  <textarea
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
                <MemoryList
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
        <span>Active memories</span>
        <strong>{metrics.activeMemories}</strong>
        <small>{metrics.totalMemories} total graph nodes</small>
      </div>
      <div className="metric-tile">
        <span>Edges</span>
        <strong>{metrics.totalEdges}</strong>
        <small>{metrics.relationshipCount} relationship types</small>
      </div>
      <div className="metric-tile">
        <span>Entities</span>
        <strong>{metrics.entityCount}</strong>
        <small>{metrics.tagCount} tags indexed</small>
      </div>
      <div className="metric-tile">
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
          aria-label="Memory capture activity"
          className="bar-chart"
          role="img"
        >
          {recentActivity.map((point) => (
            <div className="bar-column" key={point.label}>
              <div
                className="bar-fill"
                style={{ height: `${Math.max(8, point.percent)}%` }}
                title={`${point.label}: ${point.count}`}
              />
              <span>{point.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="chart-panel type-panel">
        <div className="panel-heading">
          <span>Memory mix</span>
          <strong>{typeDistribution.length} types</strong>
        </div>
        <div className="type-bars">
          {typeDistribution.length === 0 ? (
            <p className="muted">No typed memories yet.</p>
          ) : (
            typeDistribution.map((point) => (
              <div className="type-row" key={point.label}>
                <span>{point.label}</span>
                <div className="type-track">
                  <div
                    className="type-fill"
                    style={{ width: `${Math.max(4, point.percent)}%` }}
                  />
                </div>
                <strong>{point.count}</strong>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function MemoryList({
  memories,
  onForget,
  onInspect,
}: Readonly<{
  memories: Memory[];
  onForget: (id: string) => Promise<void>;
  onInspect: (id: string) => Promise<void>;
}>) {
  if (memories.length === 0) {
    return <p className="muted">No memories yet.</p>;
  }

  return (
    <div className="memory-list">
      {memories.map((memory) => (
        <article className="memory" key={memory.id}>
          <p>{memory.content}</p>
          <MemoryMeta memory={memory} />
          <div className="row">
            <Button
              onClick={() => void onInspect(memory.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              Inspect
            </Button>
            <Button
              onClick={() => void onForget(memory.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              Forget
            </Button>
          </div>
        </article>
      ))}
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
  const graph = useMemo(
    () => getKnowledgeMap(memories, neighbors, selectedMemoryId),
    [memories, neighbors, selectedMemoryId],
  );

  if (graph.nodes.length === 0) {
    return (
      <div className="knowledge-map empty-map">
        <p className="muted">Capture memories to build the knowledge map.</p>
      </div>
    );
  }

  return (
    <section className="knowledge-map" aria-label="Knowledge map">
      <div className="panel-heading">
        <span>Knowledge map</span>
        <strong>{graph.nodes.length} nodes</strong>
      </div>
      <svg role="img" viewBox="0 0 720 360" aria-label="Memory graph map">
        <title>Memory graph map</title>
        {graph.links.map((link) => (
          <line
            className="graph-link"
            key={`${link.source.id}:${link.target.id}:${link.relationship}`}
            x1={link.source.x}
            x2={link.target.x}
            y1={link.source.y}
            y2={link.target.y}
          />
        ))}
        {graph.nodes.map((node) => (
          <a
            className="graph-node-group"
            href={`#memory-${node.id}`}
            key={node.id}
            onClick={(event) => {
              event.preventDefault();
              void onInspect(node.id);
            }}
          >
            <title>{node.title}</title>
            <circle
              className={node.isSelected ? "graph-node selected" : "graph-node"}
              cx={node.x}
              cy={node.y}
              r={node.size}
            />
            <text x={node.x} y={node.y + node.size + 18}>
              {node.label}
            </text>
          </a>
        ))}
      </svg>
      <p className="muted">
        Nodes are recent memories. Lines use explicit graph edges when a memory
        is selected, then fall back to shared tags and entities.
      </p>
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

function getDashboardMetrics(
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

function getRecentActivity(memories: Memory[]): ActivityPoint[] {
  const now = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (6 - index));
    return {
      key: date.toISOString().slice(0, 10),
      label: date
        .toLocaleDateString(undefined, { weekday: "short" })
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

function getTypeDistribution(memories: Memory[]): DistributionPoint[] {
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

function getKnowledgeMap(
  memories: Memory[],
  neighbors: GraphEdge[],
  selectedMemoryId: string | null,
): KnowledgeGraph {
  const visibleMemories = memories
    .filter((memory) => memory.status !== "forgotten")
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

  return { nodes, links };
}

function sharesMemorySignal(left: Memory, right: Memory) {
  const leftSignals = new Set([...left.tags, ...left.entityIds, left.type]);
  return [...right.tags, ...right.entityIds, right.type].some((signal) =>
    leftSignals.has(signal),
  );
}

function getMemoryLabel(memory: Memory) {
  const clean = memory.content.replace(/\s+/g, " ").trim();
  if (clean.length <= 18) {
    return clean;
  }

  return `${clean.slice(0, 17)}...`;
}

function useLocalStorage(key: string, initialValue: string) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") {
      return initialValue;
    }

    return window.localStorage.getItem(key) ?? initialValue;
  });

  useEffect(() => {
    window.localStorage.setItem(key, value);
  }, [key, value]);

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

type DashboardMetrics = {
  activeMemories: number;
  totalMemories: number;
  totalEdges: number;
  relationshipCount: number;
  entityCount: number;
  tagCount: number;
  oauthConnections: number;
  recalledMemories: number;
};

type ActivityPoint = {
  key: string;
  label: string;
  count: number;
  percent: number;
};

type DistributionPoint = {
  label: string;
  count: number;
  percent: number;
};

type KnowledgeNode = {
  id: string;
  label: string;
  title: string;
  x: number;
  y: number;
  size: number;
  isSelected: boolean;
  memory: Memory;
};

type KnowledgeLink = {
  source: KnowledgeNode;
  target: KnowledgeNode;
  relationship: string;
};

type KnowledgeGraph = {
  nodes: KnowledgeNode[];
  links: KnowledgeLink[];
};
