import { describe, expect, test } from "vitest";

const runLiveE2E = process.env.OPENMEMORY_LIVE_E2E === "true";
const baseUrl =
  process.env.OPENMEMORY_LIVE_BASE_URL ??
  "https://openmemory-api.abbierman101.workers.dev";
const origin = baseUrl;

describe.runIf(runLiveE2E)("live production e2e", () => {
  test("supports hosted UI, session auth, graph recall, OAuth, and MCP bearer access", async () => {
    const email = `live-e2e-${crypto.randomUUID()}@example.com`;
    const password = "password1234";

    const health = await getJson<HealthResponse>(fetchLive("/health"));
    expect(health).toMatchObject({
      ok: true,
      service: "openmemory-api",
    });

    const dashboard = await fetchLive("/");
    expect(dashboard.status).toBe(200);
    const dashboardHtml = await dashboard.text();
    expect(dashboardHtml).toContain("Memory Dashboard");
    expect(dashboardHtml).toContain("Operations");
    expect(dashboardHtml).toContain("/assets/");

    const signUp = await fetchLive("/api/auth/sign-up/email", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        name: "Live E2E",
        email,
        password,
      }),
    });
    const cookie = cookieHeader(signUp);
    await expectOk(signUp);
    expect(cookie).toContain("better-auth");

    const session = await getJson<SessionResponse>(
      fetchLive("/api/auth/get-session", {
        headers: { cookie, origin },
      }),
    );
    expect(session.user.email).toBe(email);

    const anchor = await authedJson<MemoryResponse>(cookie, "/v1/memories", {
      method: "POST",
      body: JSON.stringify({
        content: "Boris maintains Graph Indexing for OpenMemory retrieval.",
        tags: ["architecture"],
        importance: 0.9,
      }),
    });
    const ingested = await authedJson<IngestResponse>(cookie, "/v1/ingest", {
      method: "POST",
      body: JSON.stringify({
        content:
          "Graph Indexing improves recall quality by expanding related memories.",
        source: "live-e2e",
      }),
    });
    expect(ingested.memory.entityIds).toContain("graph-indexing");
    expect(ingested.edges).toContainEqual(
      expect.objectContaining({
        targetId: anchor.id,
        relationship: "shares_entity",
      }),
    );

    const search = await authedJson<SearchResponse[]>(cookie, "/v1/search", {
      method: "POST",
      body: JSON.stringify({ q: "Boris", limit: 8 }),
    });
    expect(search).toContainEqual(
      expect.objectContaining({
        id: ingested.memory.id,
        reason: "graph",
      }),
    );

    const source = await authedJson<SourceIngestResponse>(
      cookie,
      "/v1/sources",
      {
        method: "POST",
        body: JSON.stringify({
          title: "Live E2E source notes",
          source: "live-e2e-source",
          tags: ["e2e"],
          chunkSize: 450,
          overlap: 80,
          content: [
            "Graph Indexing keeps OpenMemory source chunks connected to canonical facts.",
            "Workers AI creates embeddings and Vectorize supplies semantic candidates for source recall.",
            "Adjacent chunk edges preserve document order for RAG context assembly.",
            "Boris can use chunked source ingestion to retrieve related architecture notes.",
          ].join(" "),
        }),
      },
    );
    expect(source.sourceId).toMatch(/^src_/);
    expect(source.chunkCount).toBeGreaterThan(0);
    expect(source.memories[0]?.metadata).toMatchObject({
      sourceId: source.sourceId,
      title: "Live E2E source notes",
    });

    const stats = await authedJson<GraphStatsResponse>(
      cookie,
      "/v1/graph/stats",
    );
    expect(stats.activeMemories).toBeGreaterThanOrEqual(source.chunkCount + 2);
    expect(stats.totalEdges).toBeGreaterThan(0);

    const exported = await authedJson<GraphExportResponse>(
      cookie,
      "/v1/exports",
      {
        method: "POST",
      },
    );
    expect(exported.key).toContain("/exports/");
    expect(exported.memoryCount).toBeGreaterThanOrEqual(stats.activeMemories);
    expect(exported.writtenToR2).toBe(true);

    const oauthClient = await getJson<OAuthClientResponse>(
      fetchLive("/api/auth/oauth2/register", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          client_name: "OpenMemory Live E2E",
          redirect_uris: ["http://127.0.0.1/callback"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          scope: "openid profile memory:read memory:write",
        }),
      }),
    );
    const verifier = `openmemory-${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const authorization = await redirectUrl(
      fetchLive(
        `/api/auth/oauth2/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: oauthClient.client_id,
          redirect_uri: "http://127.0.0.1/callback",
          scope: "openid profile memory:read memory:write",
          state: "live-e2e",
          prompt: "consent",
          code_challenge: await pkceChallenge(verifier),
          code_challenge_method: "S256",
        })}`,
        {
          headers: { cookie, origin, accept: "application/json" },
          redirect: "manual",
        },
      ),
    );
    const callback =
      authorization.pathname === "/consent"
        ? new URL(
            (
              await getJson<OAuthRedirectResponse>(
                fetchLive("/api/auth/oauth2/consent", {
                  method: "POST",
                  headers: {
                    cookie,
                    origin,
                    "content-type": "application/json",
                    accept: "application/json",
                  },
                  body: JSON.stringify({
                    accept: true,
                    scope: "openid profile memory:read memory:write",
                    oauth_query: authorization.search.slice(1),
                  }),
                }),
              )
            ).url,
          )
        : authorization;
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await getJson<TokenResponse>(
      fetchLive("/api/auth/oauth2/token", {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: oauthClient.client_id,
          code: code ?? "",
          code_verifier: verifier,
          redirect_uri: "http://127.0.0.1/callback",
          resource: `${baseUrl}/mcp`,
        }),
      }),
    );
    expect(token.access_token).toBeTruthy();
    expect(token.token_type).toBe("Bearer");

    const readiness = await authedJson<ReadinessResponse>(
      cookie,
      "/v1/readiness",
    );
    expect(readiness).toMatchObject({
      service: "openmemory-api",
      tenant: {
        source: "session",
        localDevelopment: false,
      },
      auth: {
        mode: "session",
      },
      bindings: {
        authDb: true,
        durableObjects: true,
        r2Exports: true,
      },
      exports: {
        r2Configured: true,
      },
    });
    expect(readiness.tenant.id).toBeTruthy();
    expect(readiness.graph.activeMemories).toBeGreaterThanOrEqual(
      stats.activeMemories,
    );
    expect(readiness.graph.totalEdges).toBeGreaterThanOrEqual(stats.totalEdges);
    expect(readiness.relationships.catalogSize).toBeGreaterThan(8);
    expect(readiness.mcp.endpoint).toBe(`${baseUrl}/mcp`);
    expect(readiness.mcp.authorizationServer).toContain(
      "/.well-known/oauth-authorization-server/api/auth",
    );
    expect(readiness.mcp.protectedResource).toContain(
      "/.well-known/oauth-protected-resource/mcp",
    );
    expect(readiness.mcp.tools).toEqual([
      "remember",
      "recall",
      "profile",
      "forget",
    ]);
    expect(readiness.rateLimit.enabled).toBe(true);
    expect(readiness.rateLimit.limitPerMinute).toBeGreaterThan(0);
    const serializedReadiness = JSON.stringify(readiness);
    expect(serializedReadiness).not.toContain(password);
    expect(serializedReadiness).not.toContain(token.access_token);
    expect(serializedReadiness).not.toContain("Boris maintains Graph Indexing");
    expect(serializedReadiness).not.toContain(
      "Workers AI creates embeddings and Vectorize supplies semantic candidates",
    );

    const rememberText = mcpText(
      await mcpCall(token.access_token, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            content: "Live E2E can write through MCP.",
            tags: ["e2e"],
          },
        },
      }),
    );
    expect(rememberText).toContain("Stored");
    const rememberedId = rememberText.match(/Stored (mem_[^:]+):/)?.[1];
    expect(rememberedId).toBeTruthy();

    const recallText = mcpText(
      await mcpCall(token.access_token, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "recall",
          arguments: { query: "Live E2E MCP" },
        },
      }),
    );
    expect(recallText).toContain("Live E2E");

    const profileText = mcpText(
      await mcpCall(token.access_token, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "profile",
          arguments: {},
        },
      }),
    );
    expect(profileText).toContain("Live E2E can write through MCP.");

    const forgetText = mcpText(
      await mcpCall(token.access_token, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "forget",
          arguments: {
            id: rememberedId,
            reason: "live e2e cleanup",
          },
        },
      }),
    );
    expect(forgetText).toContain(`Forgot ${rememberedId}`);

    const afterForgetText = mcpText(
      await mcpCall(token.access_token, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "recall",
          arguments: { query: "Live E2E MCP" },
        },
      }),
    );
    expect(afterForgetText).not.toContain("Live E2E can write through MCP.");
  }, 60_000);
});

describe.skipIf(runLiveE2E)("live production e2e", () => {
  test("set OPENMEMORY_LIVE_E2E=true to run production smoke", () => {
    expect(runLiveE2E).toBe(false);
  });
});

function mcpText(response: unknown) {
  const result = (response as { result?: unknown }).result;
  const content = (result as { content?: Array<{ text?: string }> } | undefined)
    ?.content;
  return content?.map((item) => item.text ?? "").join("\n") ?? "";
}

function fetchLive(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, init);
}

async function authedJson<T>(
  cookie: string,
  path: string,
  init: RequestInit = {},
) {
  return getJson<T>(
    fetchLive(path, {
      ...init,
      headers: {
        cookie,
        origin,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    }),
  );
}

async function mcpCall(accessToken: string, body: Record<string, unknown>) {
  return getJson<unknown>(
    fetchLive("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}

function jsonHeaders() {
  return {
    origin,
    "content-type": "application/json",
    accept: "application/json",
  };
}

async function getJson<T>(responsePromise: Promise<Response>) {
  const response = await responsePromise;
  await expectOk(response.clone());
  return (await response.json()) as T;
}

async function expectOk(response: Response) {
  if (!response.ok) {
    throw new Error(
      `Expected 2xx response, got ${response.status}:\n${await response.text()}`,
    );
  }
}

async function redirectUrl(responsePromise: Promise<Response>) {
  const response = await responsePromise;
  const location = response.headers.get("location");
  if (location) {
    return new URL(location, baseUrl);
  }

  const body = await getJson<OAuthRedirectResponse>(Promise.resolve(response));
  return new URL(body.url, baseUrl);
}

function cookieHeader(response: Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookie = headers.getSetCookie?.() ?? [];
  return (
    setCookie.length > 0
      ? setCookie
      : splitSetCookieHeader(response.headers.get("set-cookie") ?? "")
  )
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function splitSetCookieHeader(value: string) {
  return value ? value.split(/,(?=\s*[^;,]+=)/) : [];
}

async function pkceChallenge(verifier: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return Buffer.from(hash)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

type HealthResponse = {
  ok: boolean;
  service: string;
};

type SessionResponse = {
  user: {
    email: string;
  };
};

type MemoryResponse = {
  id: string;
  entityIds: string[];
  metadata: Record<string, unknown>;
};

type SearchResponse = MemoryResponse & {
  reason: "semantic" | "keyword" | "graph";
};

type EdgeResponse = {
  targetId: string;
  relationship: string;
};

type IngestResponse = {
  memory: MemoryResponse;
  edges: EdgeResponse[];
};

type SourceIngestResponse = {
  sourceId: string;
  chunkCount: number;
  memories: MemoryResponse[];
  edges: EdgeResponse[];
};

type GraphStatsResponse = {
  activeMemories: number;
  totalEdges: number;
};

type GraphExportResponse = {
  key: string;
  memoryCount: number;
  writtenToR2: boolean;
};

type ReadinessResponse = {
  service: "openmemory-api";
  tenant: {
    id: string;
    source: "session" | "local-header";
    localDevelopment: boolean;
  };
  graph: {
    activeMemories: number;
    totalMemories: number;
    totalEdges: number;
    relationshipTypes: number;
    graphDensity: number;
    entityCount: number;
    tagCount: number;
  };
  relationships: {
    catalogSize: number;
    top: Array<{
      relationship: string;
      label: string;
      category: string;
      count: number;
    }>;
  };
  bindings: Record<
    | "authDb"
    | "durableObjects"
    | "vectorize"
    | "workersAi"
    | "r2Exports"
    | "analytics"
    | "memoryExtractionQueue"
    | "memoryExtractionWorkflow"
    | "sourceIngestionQueue"
    | "sourceIngestionWorkflow",
    boolean
  >;
  auth: {
    mode: "session" | "local-development-header";
    betterAuthUrl: string;
    socialProviders: {
      github: boolean;
      google: boolean;
    };
  };
  mcp: {
    endpoint: string;
    authorizationServer: string;
    protectedResource: string;
    tools: Array<"remember" | "recall" | "profile" | "forget">;
  };
  rateLimit: {
    enabled: boolean;
    limitPerMinute: number;
  };
  exports: {
    r2Configured: boolean;
  };
  warnings: string[];
};

type OAuthClientResponse = {
  client_id: string;
};

type OAuthRedirectResponse = {
  url: string;
};

type TokenResponse = {
  access_token: string;
  token_type: string;
};
