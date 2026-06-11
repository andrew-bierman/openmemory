import { env as workerEnv } from "cloudflare:workers";
import {
  ContextSchema,
  CreateMemorySchema,
  ForgetMemorySchema,
  SearchSchema,
  UpdateMemorySchema,
} from "@openmemory/core";
import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import {
  getGraph,
  type HeaderSource,
  resolveAuth,
  resolveTenant,
} from "./auth";
import { handleOpenMemoryAuthRequest, isAuthRoute } from "./better-auth";
import type { Env } from "./env";
import { createOpenMemoryMcpHandler } from "./mcp";
import { MemoryGraph } from "./memory-graph";

export { MemoryGraph };

const env = workerEnv as unknown as Env;

const memoryBody = t.Object({
  content: t.String({ minLength: 1, maxLength: 200_000 }),
  source: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  conversationId: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  tags: t.Optional(
    t.Array(t.String({ minLength: 1, maxLength: 80 }), { maxItems: 50 }),
  ),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
  type: t.Optional(
    t.Union([
      t.Literal("fact"),
      t.Literal("preference"),
      t.Literal("decision"),
      t.Literal("episode"),
      t.Literal("insight"),
      t.Literal("profile"),
    ]),
  ),
  confidence: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  importance: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  validFrom: t.Optional(t.String()),
  validUntil: t.Optional(t.String()),
  entityIds: t.Optional(
    t.Array(t.String({ minLength: 1, maxLength: 160 }), { maxItems: 50 }),
  ),
});

const searchBody = t.Object({
  q: t.String({ minLength: 1, maxLength: 4_000 }),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 50 })),
  tags: t.Optional(
    t.Array(t.String({ minLength: 1, maxLength: 80 }), { maxItems: 50 }),
  ),
  includeHistorical: t.Optional(t.Boolean()),
  includeForgotten: t.Optional(t.Boolean()),
});

const updateBody = t.Object({
  content: t.String({ minLength: 1, maxLength: 200_000 }),
  relationship: t.Optional(
    t.Union([t.Literal("updates"), t.Literal("extends"), t.Literal("derives")]),
  ),
  source: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  tags: t.Optional(
    t.Array(t.String({ minLength: 1, maxLength: 80 }), { maxItems: 50 }),
  ),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
  confidence: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  importance: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  validFrom: t.Optional(t.String()),
  validUntil: t.Optional(t.String()),
});

const forgetBody = t.Object({
  reason: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
});

const edgeBody = t.Object({
  sourceId: t.String({ minLength: 1 }),
  targetId: t.String({ minLength: 1 }),
  relationship: t.String({ minLength: 1, maxLength: 80 }),
  weight: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
});

const contextBody = t.Object({
  q: t.String({ minLength: 1, maxLength: 4_000 }),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
  includeProfile: t.Optional(t.Boolean()),
  includeHistorical: t.Optional(t.Boolean()),
});

function withTenant(headers: HeaderSource) {
  const auth = resolveAuth(env, headers);
  if (!auth.ok) {
    return {
      tenant: auth,
      graph: undefined,
    };
  }

  const tenant = resolveTenant(headers);
  if ("error" in tenant) {
    return {
      tenant,
      graph: undefined,
    };
  }

  return {
    tenant,
    graph: getGraph(env, tenant.tenantId),
  };
}

function errorStatus(error: string) {
  return error === "missing_tenant" || error === "unauthorized" ? 401 : 400;
}

function tenantError(tenant: ReturnType<typeof withTenant>["tenant"]): string {
  return "error" in tenant && tenant.error ? tenant.error : "unauthorized";
}

export const app = new Elysia({ adapter: CloudflareAdapter })
  .get(
    "/",
    () =>
      new Response(DASHBOARD_HTML, {
        headers: { "content-type": "text/html" },
      }),
  )
  .get("/health", () => ({
    ok: true,
    service: "openmemory-api",
    features: ["graph-memory", "profile", "context", "mcp-json-rpc"],
  }))
  .post(
    "/v1/memories",
    async ({ body, headers, status }) => {
      const { tenant, graph } = withTenant(headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const memory = await graph.createMemory(
        CreateMemorySchema.parse({
          source: "api",
          tags: [],
          metadata: {},
          ...body,
        }),
      );
      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      await indexMemory(env, tenantId, memory);
      return status(201, memory);
    },
    { body: memoryBody },
  )
  .get("/v1/memories", async ({ headers, query, status }) => {
    const { tenant, graph } = withTenant(headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    const rawLimit = typeof query.limit === "string" ? Number(query.limit) : 25;
    const includeHistorical = query.includeHistorical === "true";
    return graph.listMemories(
      Number.isFinite(rawLimit) ? rawLimit : 25,
      includeHistorical,
    );
  })
  .get("/v1/memories/:id", async ({ headers, params, status }) => {
    const { tenant, graph } = withTenant(headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    const memory = await graph.getMemory(params.id);
    if (!memory) {
      return status(404, { error: "not_found" as const });
    }

    return memory;
  })
  .patch(
    "/v1/memories/:id",
    async ({ body, headers, params, status }) => {
      const { tenant, graph } = withTenant(headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const memory = await graph.updateMemory(
        params.id,
        UpdateMemorySchema.parse({ metadata: {}, ...body }),
      );
      if (!memory) {
        return status(404, { error: "not_found" as const });
      }
      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      await indexMemory(env, tenantId, memory);
      return memory;
    },
    { body: updateBody },
  )
  .delete(
    "/v1/memories/:id",
    async ({ body, headers, params, status }) => {
      const { tenant, graph } = withTenant(headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const memory = await graph.forgetMemory(
        params.id,
        ForgetMemorySchema.parse(body ?? {}),
      );
      if (!memory) {
        return status(404, { error: "not_found" as const });
      }
      return memory;
    },
    { body: t.Optional(forgetBody) },
  )
  .post(
    "/v1/search",
    async ({ body, headers, status }) => {
      const { tenant, graph } = withTenant(headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const input = SearchSchema.parse({
        limit: 10,
        tags: [],
        ...body,
      });
      const semanticIds = await semanticSearch(
        env,
        "tenantId" in tenant ? tenant.tenantId : "",
        input.q,
        input.limit,
      );
      return graph.search({ ...input, semanticIds });
    },
    { body: searchBody },
  )
  .post(
    "/v1/context",
    async ({ body, headers, status }) => {
      const { tenant, graph } = withTenant(headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      return graph.getContext(ContextSchema.parse(body));
    },
    { body: contextBody },
  )
  .get("/v1/profile", async ({ headers, status }) => {
    const { tenant, graph } = withTenant(headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    return graph.getProfile();
  })
  .post(
    "/v1/graph/edges",
    async ({ body, headers, status }) => {
      const { tenant, graph } = withTenant(headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      return status(
        201,
        await graph.addEdge({ metadata: {}, weight: 1, ...body }),
      );
    },
    { body: edgeBody },
  )
  .get("/v1/graph/:id/neighbors", async ({ headers, params, status }) => {
    const { tenant, graph } = withTenant(headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    return graph.getNeighbors(params.id);
  });

export type App = typeof app;

const apiWorker = app.compile();
const mcpHandler = createOpenMemoryMcpHandler();

export default {
  fetch(request: Request, requestEnv: Env, ctx: ExecutionContext) {
    const pathname = new URL(request.url).pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request) });
    }

    if (isAuthRoute(pathname)) {
      return withCors(
        handleOpenMemoryAuthRequest(requestEnv, request),
        request,
      );
    }

    if (pathname === "/mcp") {
      return withCors(mcpHandler(request, requestEnv, ctx), request);
    }

    return withCors(apiWorker.fetch(request), request);
  },
} satisfies ExportedHandler<Env>;

async function withCors(
  response: Response | Promise<Response>,
  request: Request,
) {
  const resolved = await response;
  const headers = new Headers(resolved.headers);

  for (const [key, value] of corsHeaders(request)) {
    headers.set(key, value);
  }

  return new Response(resolved.body, {
    status: resolved.status,
    statusText: resolved.statusText,
    headers,
  });
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "*";

  return new Headers({
    "access-control-allow-credentials": "true",
    "access-control-allow-headers":
      "authorization, content-type, x-openmemory-user-id",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-origin": origin,
    vary: "Origin",
  });
}

async function indexMemory(env: Env, tenantId: string, memory: unknown) {
  if (!isMemoryForIndex(memory)) {
    return;
  }

  try {
    if (!env.AI || !env.MEMORY_VECTORS) {
      return;
    }

    const embedding = await embed(env, memory.content);
    if (!embedding) {
      return;
    }

    await env.MEMORY_VECTORS.upsert([
      {
        id: `${tenantId}:${memory.id}`,
        values: embedding,
        metadata: {
          tenantId,
          memoryId: memory.id,
          source: memory.source,
          tags: memory.tags,
          status: memory.status,
          isLatest: memory.isLatest,
        },
      },
    ]);
  } catch {
    // Local Wrangler cannot emulate AI/Vectorize bindings. The graph write is canonical.
  }
}

async function semanticSearch(
  env: Env,
  tenantId: string,
  q: string,
  limit: number,
) {
  try {
    if (!env.AI || !env.MEMORY_VECTORS) {
      return [];
    }

    const embedding = await embed(env, q);
    if (!embedding) {
      return [];
    }

    const matches = await env.MEMORY_VECTORS.query(embedding, {
      topK: Math.min(limit * 3, 50),
      filter: { tenantId, status: "active", isLatest: true },
      returnMetadata: true,
    });

    return matches.matches
      .map((match) => match.metadata?.memoryId)
      .filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

async function embed(env: Env, text: string) {
  const response = await env.AI?.run(env.EMBEDDING_MODEL, { text });
  const data = response as { data?: number[][] };
  return data.data?.[0];
}

function isMemoryForIndex(value: unknown): value is {
  id: string;
  content: string;
  source: string;
  tags: string[];
  status: string;
  isLatest: boolean;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "content" in value &&
    "source" in value &&
    "tags" in value
  );
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenMemory</title>
  <style>
    :root { color-scheme: light; --bg:#f7f8fa; --panel:#ffffff; --ink:#17202a; --muted:#637083; --line:#dce2ea; --accent:#0f766e; --accent-2:#7c3aed; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--ink); }
    header { height:64px; display:flex; align-items:center; justify-content:space-between; padding:0 24px; border-bottom:1px solid var(--line); background:var(--panel); }
    main { display:grid; grid-template-columns: 360px 1fr; min-height:calc(100vh - 64px); }
    aside { border-right:1px solid var(--line); background:var(--panel); padding:20px; display:flex; flex-direction:column; gap:16px; }
    section { padding:20px; display:grid; grid-template-columns: minmax(0, 1fr) 360px; gap:20px; align-items:start; }
    label { display:block; font-size:12px; font-weight:700; color:var(--muted); margin-bottom:6px; }
    input, textarea, select { width:100%; border:1px solid var(--line); border-radius:6px; padding:10px 12px; font:inherit; background:#fff; }
    textarea { min-height:120px; resize:vertical; }
    button { border:0; border-radius:6px; background:var(--accent); color:white; font-weight:700; padding:10px 12px; cursor:pointer; }
    button.secondary { background:#283443; }
    .stack { display:flex; flex-direction:column; gap:12px; }
    .row { display:flex; gap:8px; align-items:center; }
    .panel, .memory { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
    .memory { display:flex; flex-direction:column; gap:8px; }
    .meta { color:var(--muted); font-size:12px; display:flex; flex-wrap:wrap; gap:8px; }
    .pill { border:1px solid var(--line); border-radius:999px; padding:2px 8px; background:#fff; }
    .list { display:flex; flex-direction:column; gap:10px; }
    pre { white-space:pre-wrap; margin:0; color:#273444; }
    h1 { font-size:20px; margin:0; }
    h2 { font-size:16px; margin:0 0 10px; }
    @media (max-width: 900px) { main, section { grid-template-columns:1fr; } aside { border-right:0; border-bottom:1px solid var(--line); } }
  </style>
</head>
<body>
  <header>
    <h1>OpenMemory</h1>
    <div class="row"><input id="tenant" value="local-user" aria-label="Tenant" /><button id="refresh" class="secondary">Refresh</button></div>
  </header>
  <main>
    <aside>
      <form id="remember" class="stack">
        <div><label for="content">Memory</label><textarea id="content" placeholder="Save a fact, preference, decision, episode, or insight"></textarea></div>
        <div class="row"><select id="type"><option>fact</option><option>preference</option><option>decision</option><option>episode</option><option>insight</option></select><input id="tags" placeholder="tags, comma separated" /></div>
        <button>Remember</button>
      </form>
      <form id="searchForm" class="stack">
        <div><label for="query">Recall</label><input id="query" placeholder="What context do you need?" /></div>
        <button class="secondary">Search</button>
      </form>
    </aside>
    <section>
      <div class="stack">
        <div class="panel"><h2>Memories</h2><div id="memories" class="list"></div></div>
      </div>
      <div class="stack">
        <div class="panel"><h2>Profile</h2><pre id="profile"></pre></div>
        <div class="panel"><h2>Context</h2><pre id="context"></pre></div>
      </div>
    </section>
  </main>
  <script>
    const tenant = document.querySelector("#tenant");
    const headers = () => ({ "content-type": "application/json", "x-openmemory-user-id": tenant.value || "local-user" });
    async function api(path, init = {}) { const response = await fetch(path, { ...init, headers: { ...headers(), ...(init.headers || {}) } }); if (!response.ok) throw new Error(await response.text()); return response.json(); }
    function renderMemory(memory) {
      return '<article class="memory"><div>' + escapeHtml(memory.content) + '</div><div class="meta"><span class="pill">' + memory.type + '</span><span class="pill">' + memory.status + '</span><span>' + memory.tags.join(", ") + '</span></div><div class="row"><button class="secondary" data-forget="' + memory.id + '">Forget</button></div></article>';
    }
    async function refresh() {
      const memories = await api('/v1/memories?includeHistorical=true');
      document.querySelector("#memories").innerHTML = memories.map(renderMemory).join("") || '<div class="meta">No memories yet.</div>';
      const profile = await api('/v1/profile');
      document.querySelector("#profile").textContent = profile.summary;
      document.querySelectorAll("[data-forget]").forEach(button => button.onclick = async () => { await api('/v1/memories/' + button.dataset.forget, { method:'DELETE', body: JSON.stringify({ reason:'dashboard' }) }); await refresh(); });
    }
    document.querySelector("#remember").onsubmit = async (event) => { event.preventDefault(); await api('/v1/memories', { method:'POST', body: JSON.stringify({ content: content.value, type: type.value, tags: tags.value.split(',').map(t => t.trim()).filter(Boolean) }) }); content.value=''; await refresh(); };
    document.querySelector("#searchForm").onsubmit = async (event) => { event.preventDefault(); const data = await api('/v1/context', { method:'POST', body: JSON.stringify({ q: query.value, limit: 8 }) }); document.querySelector("#context").textContent = data.context; };
    document.querySelector("#refresh").onclick = refresh;
    function escapeHtml(value) { return value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
    refresh().catch(error => document.querySelector("#memories").textContent = error.message);
  </script>
</body>
</html>`;
