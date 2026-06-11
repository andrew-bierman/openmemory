import {
  type ContextResult,
  createOpenMemoryClient,
  type Memory,
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
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [type, setType] = useState("fact");
  const [query, setQuery] = useState("recent project context");
  const [context, setContext] = useState<ContextResult | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [profile, setProfile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const api = useMemo(
    () =>
      createOpenMemoryClient(apiUrl.replace(/\/+$/, ""), {
        tenantId,
        token: token || undefined,
      }),
    [apiUrl, tenantId, token],
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
      const [nextMemories, nextProfile] = await Promise.all([
        api.listMemories(),
        api.getProfile(),
      ]);
      setMemories(nextMemories);
      setProfile(nextProfile.summary);
    });
  }, [api, run]);

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

  async function forget(id: string) {
    await run(async () => {
      await api.forgetMemory(id);
      await refresh();
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
            <h2>Memories</h2>
            <div className="memory-list">
              {memories.length === 0 ? (
                <p className="muted">No memories yet.</p>
              ) : (
                memories.map((memory) => (
                  <article className="memory" key={memory.id}>
                    <p>{memory.content}</p>
                    <div className="meta">
                      <span className="pill">{memory.type}</span>
                      <span className="pill">{memory.status}</span>
                      {memory.tags.map((tag) => (
                        <span className="pill" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div>
                      <Button
                        onClick={() => void forget(memory.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Forget
                      </Button>
                    </div>
                  </article>
                ))
              )}
            </div>
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
