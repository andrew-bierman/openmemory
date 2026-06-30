import {
  type ContextResult,
  createOpenMemoryClient,
  type GraphEdge,
  type GraphExportResult,
  type GraphStats,
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

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>OpenMemory</h1>
          <p>Cloudflare-native graph memory for AI tools.</p>
        </div>

        <div className="stack">
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
        </div>

        <form className="stack auth-box" onSubmit={signIn}>
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

        <form className="stack" onSubmit={remember}>
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
        <div className="tabs">
          {(["recall", "ingest", "graph", "mcp"] as const).map((item) => (
            <Button
              key={item}
              onClick={() => setView(item)}
              type="button"
              variant={view === item ? "default" : "outline"}
            >
              {item}
            </Button>
          ))}
        </div>

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
                <h2>Ingest Source</h2>
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
                <GraphStatsPanel stats={graphStats} />
                <div className="row">
                  <Button
                    disabled={isLoading}
                    onClick={() => void exportGraph()}
                    type="button"
                    variant="outline"
                  >
                    Export
                  </Button>
                  {lastExport ? (
                    <span className="muted">
                      {lastExport.memoryCount} memories exported
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
                <h2>Memories</h2>
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
              <h2>Context</h2>
              <pre className="context">
                {context?.context || "Run recall to assemble graph context."}
              </pre>
            </div>
            <div className="panel">
              <h2>Profile</h2>
              <pre className="context">{profile || "No profile yet."}</pre>
            </div>
          </div>
        </div>
      </section>
    </main>
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
