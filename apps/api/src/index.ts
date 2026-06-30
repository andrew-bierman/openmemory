import { env as workerEnv } from "cloudflare:workers";
import {
  ContextSchema,
  CreateMemorySchema,
  createSourceId,
  ForgetMemorySchema,
  IngestSourceSchema,
  SearchSchema,
  UpdateMemorySchema,
} from "@openmemory/core";
import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import {
  getGraph,
  type HeaderSource,
  isLocalDevelopmentRequest,
  resolveAuth,
  resolveSessionTenant,
  resolveTenant,
} from "./auth";
import { handleOpenMemoryAuthRequest, isAuthRoute } from "./better-auth";
import type { Env } from "./env";
import { createOpenMemoryMcpHandler } from "./mcp";
import { MemoryGraph } from "./memory-graph";
import { enrichMemoryInput } from "./memory-signals";
import {
  listOAuthConnections,
  revokeOAuthConnection,
} from "./oauth-connections";
import { indexMemory, semanticSearch } from "./semantic-index";

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

const sourceBody = t.Object({
  content: t.String({ minLength: 1, maxLength: 500_000 }),
  source: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  tags: t.Optional(
    t.Array(t.String({ minLength: 1, maxLength: 80 }), { maxItems: 50 }),
  ),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
  chunkSize: t.Optional(t.Number({ minimum: 400, maximum: 4_000 })),
  overlap: t.Optional(t.Number({ minimum: 0, maximum: 800 })),
});

async function withTenant(request: Request, headers: HeaderSource) {
  const auth = resolveAuth(env, headers);
  if (!auth.ok) {
    return {
      tenant: auth,
      graph: undefined,
    };
  }

  const sessionTenant = await resolveSessionTenant(env, request);
  if (sessionTenant) {
    return {
      tenant: sessionTenant,
      graph: getGraph(env, sessionTenant.tenantId),
    };
  }

  const tenant = resolveTenant(headers, {
    allowHeaderTenant: isLocalDevelopmentRequest(request),
  });
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
  return error === "missing_tenant" ||
    error === "unauthorized" ||
    error === "header_tenant_disabled"
    ? 401
    : 400;
}

function tenantError(
  tenant: Awaited<ReturnType<typeof withTenant>>["tenant"],
): string {
  return "error" in tenant && tenant.error ? tenant.error : "unauthorized";
}

export const app = new Elysia({ adapter: CloudflareAdapter })
  .get(
    "/login",
    () =>
      new Response(LOGIN_HTML, {
        headers: { "content-type": "text/html" },
      }),
  )
  .get(
    "/consent",
    () =>
      new Response(CONSENT_HTML, {
        headers: { "content-type": "text/html" },
      }),
  )
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
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const memory = await graph.createMemory(
        CreateMemorySchema.parse(
          enrichMemoryInput({
            source: "api",
            tags: [],
            metadata: {},
            ...body,
          }),
        ),
      );
      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      await indexMemory(env, tenantId, memory);
      await graph.linkRelatedMemories(memory.id);
      return status(201, memory);
    },
    { body: memoryBody },
  )
  .post(
    "/v1/ingest",
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const memory = await graph.createMemory(
        CreateMemorySchema.parse(
          enrichMemoryInput({
            source: "ingest",
            tags: [],
            metadata: {},
            ...body,
          }),
        ),
      );
      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      await indexMemory(env, tenantId, memory);
      const edges = await graph.linkRelatedMemories(memory.id);
      return status(201, { memory, edges });
    },
    { body: memoryBody },
  )
  .post(
    "/v1/sources",
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const input = IngestSourceSchema.parse({
        source: "document",
        tags: [],
        metadata: {},
        ...body,
      });
      const sourceId = createSourceId();
      const chunks = chunkSourceContent(input.content, {
        chunkSize: input.chunkSize,
        overlap: input.overlap,
      });
      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      const memories = [];
      const edges = [];

      for (const chunk of chunks) {
        const memory = await graph.createMemory(
          CreateMemorySchema.parse(
            enrichMemoryInput({
              content: chunk.content,
              source: input.source,
              tags: input.tags,
              metadata: {
                ...input.metadata,
                sourceId,
                title: input.title,
                chunkIndex: chunk.index,
                chunkCount: chunks.length,
                chunkStart: chunk.start,
                chunkEnd: chunk.end,
                ingestion: {
                  strategy: "chunked-source-v1",
                  chunkSize: input.chunkSize,
                  overlap: input.overlap,
                },
              },
              type: "insight",
            }),
          ),
        );
        await indexMemory(env, tenantId, memory);
        memories.push(memory);
        edges.push(...(await graph.linkRelatedMemories(memory.id)));

        const previous = memories.at(-2);
        if (previous) {
          edges.push(
            await graph.addEdge({
              sourceId: previous.id,
              targetId: memory.id,
              relationship: "next_chunk",
              weight: 0.9,
              metadata: {
                sourceId,
                createdBy: "ingestSource",
              },
            }),
          );
          edges.push(
            await graph.addEdge({
              sourceId: memory.id,
              targetId: previous.id,
              relationship: "previous_chunk",
              weight: 0.9,
              metadata: {
                sourceId,
                createdBy: "ingestSource",
              },
            }),
          );
        }
      }

      return status(201, {
        sourceId,
        chunkCount: memories.length,
        memories,
        edges,
      });
    },
    { body: sourceBody },
  )
  .get("/v1/memories", async ({ headers, query, request, status }) => {
    const { tenant, graph } = await withTenant(request, headers);
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
  .get("/v1/memories/:id", async ({ headers, params, request, status }) => {
    const { tenant, graph } = await withTenant(request, headers);
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
    async ({ body, headers, params, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const memory = await graph.updateMemory(
        params.id,
        UpdateMemorySchema.parse(enrichMemoryInput({ metadata: {}, ...body })),
      );
      if (!memory) {
        return status(404, { error: "not_found" as const });
      }
      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      await indexMemory(env, tenantId, memory);
      await graph.linkRelatedMemories(memory.id);
      return memory;
    },
    { body: updateBody },
  )
  .delete(
    "/v1/memories/:id",
    async ({ body, headers, params, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
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
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
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
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      return graph.getContext(ContextSchema.parse(body));
    },
    { body: contextBody },
  )
  .get("/v1/profile", async ({ headers, request, status }) => {
    const { tenant, graph } = await withTenant(request, headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    return graph.getProfile();
  })
  .get("/v1/oauth/connections", async ({ request, status }) => {
    const result = await listOAuthConnections(env, request);
    return status(result.status, result.body);
  })
  .delete(
    "/v1/oauth/connections/:clientId",
    async ({ params, request, status }) => {
      const result = await revokeOAuthConnection(env, request, params.clientId);
      return status(result.status, result.body);
    },
  )
  .post("/v1/exports", async ({ headers, request, status }) => {
    const { tenant, graph } = await withTenant(request, headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    const tenantId = "tenantId" in tenant ? tenant.tenantId : "unknown";
    const graphExport = await graph.exportGraph();
    const body = JSON.stringify(graphExport);
    const key = `${tenantId}/exports/${graphExport.exportedAt.replace(/[:.]/g, "-")}.json`;

    if (env.MEMORY_EXPORTS) {
      await env.MEMORY_EXPORTS.put(key, body, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
          tenantId,
          exportedAt: graphExport.exportedAt,
          version: String(graphExport.version),
        },
      });
    }

    return status(201, {
      key,
      bytes: new TextEncoder().encode(body).byteLength,
      memoryCount: graphExport.memories.length,
      edgeCount: graphExport.edges.length,
      writtenToR2: Boolean(env.MEMORY_EXPORTS),
    });
  })
  .post("/v1/index/repair", async ({ headers, request, status }) => {
    const { tenant, graph } = await withTenant(request, headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    const tenantId = "tenantId" in tenant ? tenant.tenantId : "unknown";
    const memories = await graph.listMemories(100, false);
    for (const memory of memories) {
      await indexMemory(env, tenantId, memory);
    }

    return status(202, {
      attempted: memories.length,
      tenantId,
      vectorizeConfigured: Boolean(env.AI && env.MEMORY_VECTORS),
    });
  })
  .post(
    "/v1/graph/edges",
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
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
  .get("/v1/graph/stats", async ({ headers, request, status }) => {
    const { tenant, graph } = await withTenant(request, headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    return graph.getStats();
  })
  .get(
    "/v1/graph/:id/neighbors",
    async ({ headers, params, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      return graph.getNeighbors(params.id);
    },
  );

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

function chunkSourceContent(
  content: string,
  options: { chunkSize: number; overlap: number },
) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= options.chunkSize) {
    return [
      {
        content: normalized,
        index: 0,
        start: 0,
        end: normalized.length,
      },
    ];
  }

  const chunks: Array<{
    content: string;
    index: number;
    start: number;
    end: number;
  }> = [];
  const step = Math.max(1, options.chunkSize - options.overlap);
  let start = 0;

  while (start < normalized.length) {
    const hardEnd = Math.min(start + options.chunkSize, normalized.length);
    const end =
      hardEnd === normalized.length
        ? hardEnd
        : findChunkBoundary(normalized, start, hardEnd);
    chunks.push({
      content: normalized.slice(start, end).trim(),
      index: chunks.length,
      start,
      end,
    });

    if (end === normalized.length) {
      break;
    }

    start = Math.max(end - options.overlap, start + step);
  }

  return chunks.filter((chunk) => chunk.content.length > 0);
}

function findChunkBoundary(content: string, start: number, hardEnd: number) {
  const minEnd = start + Math.floor((hardEnd - start) * 0.65);
  const candidate = Math.max(
    content.lastIndexOf(". ", hardEnd),
    content.lastIndexOf("\n", hardEnd),
    content.lastIndexOf(" ", hardEnd),
  );
  return candidate > minEnd ? candidate + 1 : hardEnd;
}

const PAGE_STYLE = `
  :root { color-scheme: light; --bg:#f6f7f9; --panel:#ffffff; --ink:#18212f; --muted:#627085; --line:#dfe5ee; --accent:#0f766e; --danger:#991b1b; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--ink); }
  button, input, select, textarea { font: inherit; }
  header { min-height:64px; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:0 24px; border-bottom:1px solid var(--line); background:var(--panel); }
  h1 { font-size:20px; line-height:1.2; margin:0; }
  h2 { font-size:16px; margin:0 0 12px; }
  main { min-height:calc(100vh - 64px); }
  .app-shell { display:grid; grid-template-columns: 340px minmax(0, 1fr); }
  aside { border-right:1px solid var(--line); background:var(--panel); padding:20px; display:flex; flex-direction:column; gap:16px; }
  section { padding:20px; display:grid; grid-template-columns:minmax(0, 1fr) 380px; gap:18px; align-items:start; }
  label { display:block; font-size:12px; font-weight:700; color:#445166; margin-bottom:6px; }
  input, textarea, select { width:100%; border:1px solid #d8e0ea; border-radius:6px; padding:9px 10px; background:#fff; color:var(--ink); }
  textarea { min-height:140px; resize:vertical; }
  button { border:0; border-radius:6px; background:var(--accent); color:white; font-weight:700; padding:10px 12px; cursor:pointer; }
  button.secondary { background:#283443; }
  button.ghost { color:#283443; background:#eef2f7; }
  button:disabled { cursor:not-allowed; opacity:.55; }
  .stack { display:flex; flex-direction:column; gap:12px; }
  .row { display:flex; gap:8px; align-items:center; }
  .panel, .memory { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
  .memory { display:flex; flex-direction:column; gap:8px; }
  .meta { color:var(--muted); font-size:12px; display:flex; flex-wrap:wrap; gap:8px; }
  .pill { border:1px solid #d8e0ea; border-radius:999px; padding:2px 8px; background:#fff; }
  .list { display:flex; flex-direction:column; gap:10px; }
  .auth-card { width:min(420px, calc(100vw - 32px)); margin:8vh auto; }
  .error { border:1px solid #fecaca; border-radius:6px; background:#fff1f2; color:var(--danger); padding:10px; font-size:13px; }
  .hidden { display:none !important; }
  pre { white-space:pre-wrap; margin:0; color:#273444; line-height:1.5; }
  @media (max-width: 900px) { header { align-items:flex-start; flex-direction:column; padding:16px; } .app-shell, section { grid-template-columns:1fr; } aside { border-right:0; border-bottom:1px solid var(--line); } }
`;

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenMemory</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <header>
    <h1>OpenMemory</h1>
    <div class="row"><span class="meta" id="session"></span><button id="refresh" class="ghost">Refresh</button><a href="/login"><button class="ghost">Account</button></a><button id="signOut" class="secondary">Sign out</button></div>
  </header>
  <main class="app-shell">
    <aside>
      <div id="authNotice" class="panel hidden">
        <div class="stack">
          <strong>Sign in required</strong>
          <span class="meta">The deployed dashboard uses Better Auth session cookies.</span>
          <a href="/login"><button type="button">Sign in</button></a>
        </div>
      </div>
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
    const localHeaders = location.hostname === "localhost" || location.hostname === "127.0.0.1" ? { "x-openmemory-user-id": "local-user" } : {};
    async function api(path, init = {}) { const response = await fetch(path, { ...init, credentials: "include", headers: { "content-type": "application/json", ...localHeaders, ...(init.headers || {}) } }); if (!response.ok) throw new Error(await response.text()); return response.json(); }
    async function loadSession() {
      const response = await fetch("/api/auth/get-session", { credentials: "include" });
      const data = response.ok ? await response.json() : null;
      const user = data && data.user ? data.user : null;
      document.querySelector("#session").textContent = user ? user.email : "Not signed in";
      document.querySelector("#authNotice").classList.toggle("hidden", Boolean(user) || Boolean(localHeaders["x-openmemory-user-id"]));
      return user;
    }
    function renderMemory(memory) {
      return '<article class="memory"><div>' + escapeHtml(memory.content) + '</div><div class="meta"><span class="pill">' + memory.type + '</span><span class="pill">' + memory.status + '</span><span>' + memory.tags.join(", ") + '</span></div><div class="row"><button class="secondary" data-forget="' + memory.id + '">Forget</button></div></article>';
    }
    async function refresh() {
      await loadSession();
      const memories = await api('/v1/memories');
      document.querySelector("#memories").innerHTML = memories.map(renderMemory).join("") || '<div class="meta">No memories yet.</div>';
      const profile = await api('/v1/profile');
      document.querySelector("#profile").textContent = profile.summary;
      document.querySelectorAll("[data-forget]").forEach(button => button.onclick = async () => { await api('/v1/memories/' + button.dataset.forget, { method:'DELETE', body: JSON.stringify({ reason:'dashboard' }) }); await refresh(); });
    }
    document.querySelector("#remember").onsubmit = async (event) => { event.preventDefault(); await api('/v1/memories', { method:'POST', body: JSON.stringify({ content: content.value, type: type.value, tags: tags.value.split(',').map(t => t.trim()).filter(Boolean) }) }); content.value=''; await refresh(); };
    document.querySelector("#searchForm").onsubmit = async (event) => { event.preventDefault(); const data = await api('/v1/context', { method:'POST', body: JSON.stringify({ q: query.value, limit: 8 }) }); document.querySelector("#context").textContent = data.context; };
    document.querySelector("#refresh").onclick = refresh;
    document.querySelector("#signOut").onclick = async () => { await fetch("/api/auth/sign-out", { method: "POST", credentials: "include" }); location.href = "/login"; };
    function escapeHtml(value) { return value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
    refresh().catch(error => document.querySelector("#memories").textContent = error.message);
  </script>
</body>
</html>`;

const LOGIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenMemory Login</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <header><h1>OpenMemory</h1><a href="/"><button class="ghost">Dashboard</button></a></header>
  <main>
    <div class="panel auth-card">
      <form id="authForm" class="stack">
        <h2>Account</h2>
        <div id="error" class="error hidden"></div>
        <div><label for="name">Name</label><input id="name" autocomplete="name" value="OpenMemory User" /></div>
        <div><label for="email">Email</label><input id="email" autocomplete="email" required type="email" /></div>
        <div><label for="password">Password</label><input id="password" autocomplete="current-password" minlength="8" required type="password" /></div>
        <div class="row"><button id="signIn" type="submit">Sign in</button><button id="signUp" class="secondary" type="button">Create account</button></div>
      </form>
    </div>
  </main>
  <script>
    const form = document.querySelector("#authForm");
    const error = document.querySelector("#error");
    function showError(message) { error.textContent = message; error.classList.remove("hidden"); }
    async function auth(path) {
      error.classList.add("hidden");
      const body = { email: email.value, password: password.value, name: name.value || email.value };
      const response = await fetch(path, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await response.text());
      const next = new URLSearchParams(location.search).get("redirect") || "/";
      location.href = next;
    }
    form.onsubmit = (event) => { event.preventDefault(); auth("/api/auth/sign-in/email").catch((caught) => showError(caught.message)); };
    signUp.onclick = () => auth("/api/auth/sign-up/email").catch((caught) => showError(caught.message));
  </script>
</body>
</html>`;

const CONSENT_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenMemory Consent</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <header><h1>OpenMemory</h1></header>
  <main>
    <div class="panel auth-card">
      <div class="stack">
        <h2>Authorize client</h2>
        <p class="meta" id="details"></p>
        <div id="error" class="error hidden"></div>
        <div class="row"><button id="approve">Allow</button><button id="deny" class="secondary">Deny</button></div>
      </div>
    </div>
  </main>
  <script>
    const params = new URLSearchParams(location.search);
    const scope = params.get("scope") || "";
    details.textContent = (params.get("client_id") || "This client") + " is requesting: " + (scope || "default OpenMemory access");
    function showError(message) { error.textContent = message; error.classList.remove("hidden"); }
    async function consent(accept) {
      const response = await fetch("/api/auth/oauth2/consent", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ accept, scope, oauth_query: location.search.slice(1) }) });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json().catch(() => ({}));
      if (data && data.url) location.href = data.url;
      else if (data && data.redirectURL) location.href = data.redirectURL;
      else location.href = "/";
    }
    approve.onclick = () => consent(true).catch((caught) => showError(caught.message));
    deny.onclick = () => consent(false).catch((caught) => showError(caught.message));
  </script>
</body>
</html>`;
