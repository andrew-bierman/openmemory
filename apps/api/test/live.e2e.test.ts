import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GraphExportPayloadSchema } from "@openmemory/core";
import { describe, expect, test } from "vitest";

const runLiveE2E = process.env.OPENMEMORY_LIVE_E2E === "true";
const runLiveBenchmark = process.env.OPENMEMORY_LIVE_BENCHMARK === "true";
const baseUrl =
  process.env.OPENMEMORY_LIVE_BASE_URL ??
  "https://openmemory-api.abbierman101.workers.dev";
const origin = baseUrl;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const liveGraphSize = parseLiveGraphSize(
  process.env.OPENMEMORY_LIVE_GRAPH_SIZE,
);
const liveRecallThresholdMs = 12_000;

describe.runIf(runLiveE2E)("live production e2e", () => {
  test("supports hosted UI, session auth, graph recall, OAuth, and MCP bearer access", async () => {
    const email = `live-e2e-${crypto.randomUUID()}@example.com`;
    const password = "password1234";
    let cookie = "";
    let cleanup: { confirmEmail: string; confirmTenantId: string } | undefined;

    try {
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
      cookie = cookieHeader(signUp);
      await expectOk(signUp);
      expect(cookie).toContain("better-auth");

      const session = await getJson<SessionResponse>(
        fetchLive("/api/auth/get-session", {
          headers: { cookie, origin },
        }),
      );
      expect(session.user.email).toBe(email);

      const account = await authedJson<AccountResponse>(cookie, "/v1/account");
      cleanup = {
        confirmEmail: account.user.email,
        confirmTenantId: account.workspace.tenantId,
      };

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

      const conversationId = `live-chat-${crypto.randomUUID()}`;
      const conversation = await authedJson<SourceIngestResponse>(
        cookie,
        "/v1/conversations",
        {
          method: "POST",
          body: JSON.stringify({
            conversationId,
            title: "Live E2E transcript",
            tags: ["e2e", "chat"],
            messages: [
              {
                role: "user",
                content:
                  "Remember that live OpenMemory transcript ingestion should link AI chat decisions.",
              },
              {
                role: "assistant",
                content:
                  "Stored the transcript with conversation id provenance for future recall.",
              },
            ],
          }),
        },
      );
      expect(conversation.sourceId).toMatch(/^src_/);
      expect(conversation.chunkCount).toBeGreaterThan(0);
      expect(conversation.memories[0]).toMatchObject({
        conversationId,
        source: "conversation",
      });
      expect(conversation.memories[0]?.metadata).toMatchObject({
        sourceId: conversation.sourceId,
        conversationId,
        ingestion: {
          strategy: "conversation-transcript-v1",
        },
      });

      const stats = await authedJson<GraphStatsResponse>(
        cookie,
        "/v1/graph/stats",
      );
      expect(stats.activeMemories).toBeGreaterThanOrEqual(
        source.chunkCount + 2,
      );
      expect(stats.totalEdges).toBeGreaterThan(0);

      const indexRepair = await authedJson<IndexRepairResponse>(
        cookie,
        "/v1/index/repair",
        {
          method: "POST",
        },
      );
      expect(indexRepair.vectorizeConfigured).toBe(true);
      expect(indexRepair.expectedVectors).toBeGreaterThanOrEqual(
        stats.activeMemories,
      );
      expect(indexRepair.semanticIndex).toMatchObject({
        configured: true,
        vectorizeConfigured: true,
        workersAiConfigured: true,
      });
      expect(indexRepair.semanticIndex.status).not.toBe("unconfigured");

      const currentIndex = await waitForSemanticIndex(cookie);
      expect(currentIndex.semanticIndex.status).toBe("current");
      expect(currentIndex.failed).toBe(0);

      const semanticSearch = await waitForSemanticSearch(
        cookie,
        "Vectorize semantic candidates source chunks document order",
      );
      expect(semanticSearch).toContainEqual(
        expect.objectContaining({
          reason: "semantic",
        }),
      );

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
          headers: {
            cookie,
            ...jsonHeaders(),
          },
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
          vectorize: true,
          workersAi: true,
        },
        exports: {
          r2Configured: true,
        },
        semanticIndex: {
          configured: true,
          vectorizeConfigured: true,
          workersAiConfigured: true,
        },
      });
      expect(readiness.tenant.id).toBeTruthy();
      expect(readiness.graph.activeMemories).toBeGreaterThanOrEqual(
        stats.activeMemories,
      );
      expect(readiness.graph.totalEdges).toBeGreaterThanOrEqual(
        stats.totalEdges,
      );
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
      expect(readiness.semanticIndex.expectedVectors).toBeGreaterThanOrEqual(
        stats.activeMemories,
      );
      expect(readiness.semanticIndex.status).not.toBe("unconfigured");
      const serializedReadiness = JSON.stringify(readiness);
      expect(serializedReadiness).not.toContain(password);
      expect(serializedReadiness).not.toContain(token.access_token);
      expect(serializedReadiness).not.toContain(
        "Boris maintains Graph Indexing",
      );
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

      const resources = JSON.stringify(
        await mcpCall(token.access_token, {
          jsonrpc: "2.0",
          id: "resources",
          method: "resources/list",
        }),
      );
      expect(resources).toContain("openmemory://profile");
      expect(resources).toContain("openmemory://recent");

      for (const uri of ["openmemory://profile", "openmemory://recent"]) {
        const resource = JSON.stringify(
          await mcpCall(token.access_token, {
            jsonrpc: "2.0",
            id: uri,
            method: "resources/read",
            params: { uri },
          }),
        );
        expect(resource).toContain("Live E2E can write through MCP.");
      }

      const prompts = JSON.stringify(
        await mcpCall(token.access_token, {
          jsonrpc: "2.0",
          id: "prompts",
          method: "prompts/list",
        }),
      );
      expect(prompts).toContain("context");

      const contextPrompt = JSON.stringify(
        await mcpCall(token.access_token, {
          jsonrpc: "2.0",
          id: "context-prompt",
          method: "prompts/get",
          params: {
            name: "context",
            arguments: {
              query: "Live E2E MCP",
              limit: "5",
            },
          },
        }),
      );
      expect(contextPrompt).toContain("Live E2E can write through MCP.");

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

      const revoked = await authedJson<OAuthRevokeResponse>(
        cookie,
        `/v1/oauth/connections/${oauthClient.client_id}`,
        {
          method: "DELETE",
        },
      );
      expect(revoked).toEqual({
        clientId: oauthClient.client_id,
        revoked: true,
      });
    } finally {
      if (cookie && cleanup) {
        await cleanupLiveAccount(cookie, cleanup, "Live E2E");
      }
    }
  }, 180_000);
});

describe.skipIf(runLiveE2E)("live production e2e", () => {
  test("set OPENMEMORY_LIVE_E2E=true to run production smoke", () => {
    expect(runLiveE2E).toBe(false);
  });
});

describe.runIf(runLiveBenchmark)("live production graph benchmark", () => {
  test("keeps hosted graph recall bounded on a synthetic tenant", async () => {
    const email = `live-benchmark-${crypto.randomUUID()}@example.com`;
    const password = "password1234";
    let cookie = "";
    let cleanup: { confirmEmail: string; confirmTenantId: string } | undefined;

    try {
      const signUp = await fetchLive("/api/auth/sign-up/email", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          name: "Live Benchmark",
          email,
          password,
        }),
      });
      cookie = cookieHeader(signUp);
      await expectOk(signUp);

      const account = await authedJson<AccountResponse>(cookie, "/v1/account");
      cleanup = {
        confirmEmail: account.user.email,
        confirmTenantId: account.workspace.tenantId,
      };

      const graphExport = createBenchmarkGraphExport(liveGraphSize);
      const importStartedAt = performance.now();
      const imported = await authedJson<GraphImportResponse>(
        cookie,
        "/v1/imports",
        {
          method: "POST",
          body: JSON.stringify({
            confirmTenantId: account.workspace.tenantId,
            mode: "merge",
            export: graphExport,
          }),
        },
      );
      const importElapsedMs = performance.now() - importStartedAt;
      expect(imported.memoriesImported).toBe(liveGraphSize);
      expect(imported.edgesImported).toBe(graphExport.edges.length);

      const stats = await authedJson<GraphStatsResponse>(
        cookie,
        "/v1/graph/stats",
      );
      expect(stats.activeMemories).toBeGreaterThanOrEqual(liveGraphSize);
      expect(stats.totalEdges).toBeGreaterThanOrEqual(graphExport.edges.length);

      const recallStartedAt = performance.now();
      const results = await authedJson<SearchResponse[]>(cookie, "/v1/search", {
        method: "POST",
        body: JSON.stringify({
          q: "Atlas Graph Indexing retrieval notes",
          limit: 10,
        }),
      });
      const recallElapsedMs = performance.now() - recallStartedAt;

      await appendBenchmarkReport({
        type: "live-production-graph-scale",
        tenant: account.workspace.tenantId,
        baseUrl,
        graphSize: liveGraphSize,
        activeMemories: stats.activeMemories,
        totalEdges: stats.totalEdges,
        importedMemories: imported.memoriesImported,
        importedEdges: imported.edgesImported,
        importElapsedMs: Number(importElapsedMs.toFixed(2)),
        recallLimit: 10,
        recallResultCount: results.length,
        recallElapsedMs: Number(recallElapsedMs.toFixed(2)),
        recallElapsedThresholdMs: liveRecallThresholdMs,
      });

      expect(results).toHaveLength(10);
      expect(results[0]?.content).toContain("Atlas");
      expect(recallElapsedMs).toBeLessThan(liveRecallThresholdMs);
    } finally {
      if (cookie && cleanup) {
        await cleanupLiveAccount(cookie, cleanup, "Live benchmark");
      }
    }
  }, 180_000);
});

describe.skipIf(runLiveBenchmark)("live production graph benchmark", () => {
  test("set OPENMEMORY_LIVE_BENCHMARK=true to run production graph benchmark", () => {
    expect(runLiveBenchmark).toBe(false);
  });
});

describe("live benchmark helpers", () => {
  test("clamps requested hosted graph size", () => {
    expect(parseLiveGraphSize(undefined)).toBe(80);
    expect(parseLiveGraphSize("12")).toBe(40);
    expect(parseLiveGraphSize("72.8")).toBe(72);
    expect(parseLiveGraphSize("10000")).toBe(160);
  });

  test("generates a graph export accepted by the import schema", () => {
    const graphExport = GraphExportPayloadSchema.parse(
      createBenchmarkGraphExport(40),
    );

    expect(graphExport.memories).toHaveLength(40);
    expect(graphExport.edges).toHaveLength(39);
    expect(graphExport.memories[0]).toMatchObject({
      source: "live-production-benchmark",
      status: "active",
      isLatest: true,
    });
    expect(graphExport.edges[0]).toMatchObject({
      sourceId: "mem_live_benchmark_0000",
      targetId: "mem_live_benchmark_0001",
      relationship: "supports",
    });
  });
});

function createBenchmarkGraphExport(graphSize: number) {
  const importedAt = "2026-07-18T00:00:00.000Z";
  const topics = ["Atlas", "Borealis", "Cosmos", "Delta"];
  const memories = Array.from({ length: graphSize }, (_, index) => {
    const topic = topics[index % topics.length];
    return {
      id: `mem_live_benchmark_${index.toString().padStart(4, "0")}`,
      content: `${topic} project memory ${index}: Graph Indexing connects hosted source chunks, decisions, and retrieval notes.`,
      source: "live-production-benchmark",
      type: "fact" as const,
      tags: ["live-benchmark", topic.toLowerCase()],
      metadata: {
        benchmark: "live-production-graph-scale",
        topic,
        index,
      },
      entityIds: [slugifyEntity(topic), "graph-indexing"],
      confidence: index % 10 === 0 ? 0.95 : 0.7,
      importance: index % 10 === 0 ? 0.9 : 0.5,
      status: "active" as const,
      isLatest: true,
      version: 1,
      createdAt: importedAt,
      updatedAt: importedAt,
    };
  });
  const edges = memories.slice(1).map((memory, index) => ({
    sourceId: memories[index]?.id ?? memory.id,
    targetId: memory.id,
    relationship: index % 3 === 0 ? "supports" : "shares_entity",
    weight: index % 3 === 0 ? 0.8 : 0.7,
    metadata: { benchmark: "live-production-graph-scale" },
    createdAt: importedAt,
    updatedAt: importedAt,
  }));

  return {
    version: 1 as const,
    exportedAt: importedAt,
    stats: {
      benchmark: "live-production-graph-scale",
      graphSize,
    },
    memories,
    edges,
  };
}

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

async function waitForSemanticSearch(cookie: string, query: string) {
  let latest: SearchResponse[] = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    latest = await authedJson<SearchResponse[]>(cookie, "/v1/search", {
      method: "POST",
      body: JSON.stringify({ q: query, limit: 8 }),
    });
    if (latest.some((result) => result.reason === "semantic")) {
      return latest;
    }
    await sleep(1_000);
  }

  return latest;
}

async function waitForSemanticIndex(cookie: string) {
  let latest: IndexRepairResponse | undefined;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    latest = await authedJson<IndexRepairResponse>(cookie, "/v1/index/repair", {
      method: "POST",
    });
    if (
      latest.semanticIndex.status === "current" &&
      latest.failed === 0 &&
      latest.errorSample.length === 0
    ) {
      return latest;
    }
    await sleep(5_000);
  }

  throw new Error(
    `Semantic index did not become current: ${JSON.stringify(latest)}`,
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupLiveAccount(
  cookie: string,
  cleanup: { confirmEmail: string; confirmTenantId: string },
  label: string,
) {
  const response = await fetchLive("/v1/account", {
    method: "DELETE",
    headers: {
      cookie,
      origin,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(cleanup),
  });
  if (!response.ok) {
    throw new Error(
      `${label} account cleanup failed with ${response.status}: ${await response.text()}`,
    );
  }
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

async function appendBenchmarkReport(entry: Record<string, unknown>) {
  const reportPath = process.env.OPENMEMORY_BENCHMARK_REPORT;
  if (!reportPath) {
    return;
  }
  const resolvedReportPath = reportPath.startsWith("/")
    ? reportPath
    : join(repoRoot, reportPath);

  await mkdir(dirname(resolvedReportPath), { recursive: true });
  await appendFile(
    resolvedReportPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      commit: process.env.GITHUB_SHA ?? process.env.CI_COMMIT_SHA,
      ...entry,
    })}\n`,
  );
}

function parseLiveGraphSize(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 80;
  }
  return Math.max(40, Math.min(160, Math.trunc(parsed)));
}

function slugifyEntity(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
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

type AccountResponse = {
  user: {
    email: string;
  };
  workspace: {
    tenantId: string;
  };
};

type MemoryResponse = {
  id: string;
  content: string;
  conversationId?: string;
  entityIds: string[];
  metadata: Record<string, unknown>;
  source: string;
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

type IndexRepairResponse = {
  attempted: number;
  expectedVectors: number;
  failed: number;
  indexed: number;
  skipped: number;
  errorSample: Array<{
    vectorId?: string;
    error: string;
  }>;
  vectorizeConfigured: boolean;
  semanticIndex: {
    configured: boolean;
    workersAiConfigured: boolean;
    vectorizeConfigured: boolean;
    expectedVectors: number;
    status: "current" | "needs_repair" | "unchecked" | "unconfigured";
  };
};

type GraphImportResponse = {
  memoriesImported: number;
  edgesImported: number;
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
    socialProviders: Record<
      "github" | "google",
      {
        configured: boolean;
        hasClientId: boolean;
        hasClientSecret: boolean;
        status: "ready" | "missing" | "partial";
      }
    >;
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
  semanticIndex: {
    configured: boolean;
    workersAiConfigured: boolean;
    vectorizeConfigured: boolean;
    expectedVectors: number;
    staleVectorCandidates: number;
    checkedVectorSample: number;
    missingVectorSample: string[];
    staleVectorSample: string[];
    repairRecommended: boolean;
    status: "current" | "needs_repair" | "unchecked" | "unconfigured";
  };
  rerank: {
    configured: boolean;
    workersAiConfigured: boolean;
    model?: string;
    timeoutMs: number;
    status: "enabled" | "disabled" | "misconfigured";
  };
  warnings: string[];
};

type OAuthClientResponse = {
  client_id: string;
};

type OAuthRevokeResponse = {
  clientId: string;
  revoked: boolean;
};

type OAuthRedirectResponse = {
  url: string;
};

type TokenResponse = {
  access_token: string;
  token_type: string;
};
