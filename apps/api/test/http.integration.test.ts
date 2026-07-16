import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, test } from "vitest";
import { isLocalDevelopmentRequest, resolveTenant } from "../src/auth";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const externalTmpRoot = "/Volumes/CrucialX10/tmp/openmemory-tests";
const testTmpRoot = existsSync("/Volumes/CrucialX10")
  ? externalTmpRoot
  : tmpdir();

const workers: WorkerProcess[] = [];

afterAll(async () => {
  await Promise.all(workers.map((worker) => worker.stop()));
});

test("worker API isolates tenants and supports memory recall plus graph edges", async () => {
  const worker = await startWorker();
  workers.push(worker);

  const tenantA = `tenant-a-${crypto.randomUUID()}`;
  const tenantB = `tenant-b-${crypto.randomUUID()}`;

  const health = await worker.fetch("/health");
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({
    ok: true,
    service: "openmemory-api",
  });
  expect(health.headers.get("x-openmemory-request-id")).toMatch(
    /^[\da-f-]{36}$/,
  );
  expect(health.headers.get("x-ratelimit-limit")).toBeTruthy();

  const oauthMetadata = await getJson<OAuthMetadataResponse>(
    await worker.fetch("/.well-known/oauth-authorization-server"),
  );
  expect(oauthMetadata.authorization_endpoint).toContain(
    "/api/auth/oauth2/authorize",
  );
  expect(oauthMetadata.registration_endpoint).toContain(
    "/api/auth/oauth2/register",
  );
  expect(oauthMetadata.scopes_supported).toContain("memory:read");
  const issuerOAuthMetadata = await getJson<OAuthMetadataResponse>(
    await worker.fetch("/.well-known/oauth-authorization-server/api/auth"),
  );
  expect(issuerOAuthMetadata.issuer).toContain("/api/auth");
  expect(issuerOAuthMetadata.authorization_endpoint).toBe(
    oauthMetadata.authorization_endpoint,
  );
  const protectedResourceMetadata =
    await getJson<ProtectedResourceMetadataResponse>(
      await worker.fetch("/.well-known/oauth-protected-resource/mcp"),
    );
  expect(protectedResourceMetadata.resource).toContain("/mcp");
  expect(protectedResourceMetadata.authorization_servers).toContain(
    `${worker.baseUrl}/.well-known/oauth-authorization-server/api/auth`,
  );
  expect(protectedResourceMetadata.scopes_supported).toContain("memory:write");
  expect(protectedResourceMetadata.bearer_methods_supported).toContain(
    "header",
  );

  const oauthClient = await getJson<OAuthClientResponse>(
    await worker.fetch("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "OpenMemory MCP Smoke",
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "openid profile memory:read memory:write",
      }),
    }),
  );
  expect(oauthClient.client_id).toBeTruthy();
  expect(oauthClient.token_endpoint_auth_method).toBe("none");

  const unauthorized = await worker.fetch("/v1/memories");
  expect(unauthorized.status).toBe(401);
  expect(await unauthorized.json()).toMatchObject({
    error: "missing_tenant",
  });

  const invalidCreate = await worker.fetch("/v1/memories", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-openmemory-user-id": tenantA,
    },
    body: JSON.stringify({ content: "" }),
  });
  expect(invalidCreate.status).toBeGreaterThanOrEqual(400);

  const memoryA = await createMemory(worker, tenantA, {
    content: "OpenMemory stores graph memory in Durable Object SQLite.",
    tags: ["architecture"],
    metadata: { sourceId: "doc-1" },
  });
  const memoryB = await createMemory(worker, tenantA, {
    content: "Vectorize supplies semantic candidates for recall.",
    tags: ["retrieval"],
  });

  const listA = await getJson<MemoryResponse[]>(
    await worker.fetch("/v1/memories", {
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(listA.map((memory) => memory.id)).toContain(memoryA.id);
  expect(listA.map((memory) => memory.id)).toContain(memoryB.id);

  const listB = await getJson<MemoryResponse[]>(
    await worker.fetch("/v1/memories", {
      headers: tenantHeaders(tenantB),
    }),
  );
  expect(listB).toEqual([]);

  const crossTenantRead = await worker.fetch(`/v1/memories/${memoryA.id}`, {
    headers: tenantHeaders(tenantB),
  });
  expect(crossTenantRead.status).toBe(404);

  const searchResults = await getJson<SearchResponse[]>(
    await worker.fetch("/v1/search", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenantA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        q: "durable sqlite graph",
        limit: 5,
      }),
    }),
  );
  expect(searchResults[0]).toMatchObject({
    id: memoryA.id,
    reason: "keyword",
  });

  const filteredSearch = await getJson<SearchResponse[]>(
    await worker.fetch("/v1/search", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenantA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        q: "durable sqlite graph",
        tags: ["retrieval"],
      }),
    }),
  );
  expect(filteredSearch).toEqual([]);

  await addEdge(worker, tenantA, {
    sourceId: memoryB.id,
    targetId: memoryA.id,
    relationship: "supports",
    weight: 0.75,
    metadata: { reason: "retrieval depends on canonical storage" },
  });
  await addEdge(worker, tenantA, {
    sourceId: memoryB.id,
    targetId: memoryA.id,
    relationship: "supports",
    weight: 0.8,
    metadata: { reason: "idempotent replacement" },
  });

  const neighbors = await getJson<EdgeResponse[]>(
    await worker.fetch(`/v1/graph/${memoryA.id}/neighbors`, {
      headers: tenantHeaders(tenantA),
    }),
  );
  const matchingEdges = neighbors.filter(
    (edge) =>
      edge.sourceId === memoryB.id &&
      edge.targetId === memoryA.id &&
      edge.relationship === "supports",
  );
  expect(matchingEdges).toHaveLength(1);
  expect(matchingEdges[0]?.weight).toBe(0.8);

  const exported = await getJson<GraphExportResponse>(
    await worker.fetch("/v1/exports", {
      method: "POST",
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(exported.key).toContain(`${tenantA}/exports/`);
  expect(exported.memoryCount).toBe(2);
  expect(exported.edgeCount).toBeGreaterThanOrEqual(1);
  expect(exported.bytes).toBeGreaterThan(500);

  const repair = await getJson<IndexRepairResponse>(
    await worker.fetch("/v1/index/repair", {
      method: "POST",
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(repair).toMatchObject({
    attempted: 2,
    tenantId: tenantA,
  });
}, 45_000);

test("worker API supports memory lifecycle, profile context, MCP, and dashboard", async () => {
  const worker = await startWorker();
  workers.push(worker);

  const tenant = `tenant-alpha-${crypto.randomUUID()}`;
  const original = await createMemory(worker, tenant, {
    content: "Alex works at Google on search infrastructure.",
    tags: ["people", "work"],
    type: "fact",
    importance: 0.9,
  });

  const updated = await getJson<MemoryResponse>(
    await worker.fetch(`/v1/memories/${original.id}`, {
      method: "PATCH",
      headers: {
        ...tenantHeaders(tenant),
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        content: "Alex works at Stripe on payments infrastructure.",
        relationship: "updates",
        tags: ["people", "work"],
        importance: 0.95,
      }),
    }),
  );
  expect(updated.id).not.toBe(original.id);
  expect(updated.supersedesId).toBe(original.id);

  const currentSearch = await search(worker, tenant, {
    q: "where does Alex work",
  });
  expect(currentSearch.map((memory) => memory.id)).toContain(updated.id);
  expect(currentSearch.map((memory) => memory.id)).not.toContain(original.id);

  const historicalSearch = await search(worker, tenant, {
    q: "Google Alex",
    includeHistorical: true,
  });
  expect(historicalSearch.map((memory) => memory.id)).toContain(original.id);
  expect(
    historicalSearch.find((memory) => memory.id === original.id)?.status,
  ).toBe("superseded");

  const neighbors = await getJson<EdgeResponse[]>(
    await worker.fetch(`/v1/graph/${original.id}/neighbors`, {
      headers: tenantHeaders(tenant),
    }),
  );
  expect(neighbors).toContainEqual(
    expect.objectContaining({
      sourceId: updated.id,
      targetId: original.id,
      relationship: "updates",
    }),
  );

  const profile = await getJson<ProfileResponse>(
    await worker.fetch("/v1/profile", {
      headers: tenantHeaders(tenant),
    }),
  );
  expect(profile.summary).toContain("Stripe");
  expect(profile.summary).not.toContain("Google");

  const context = await getJson<ContextResponse>(
    await worker.fetch("/v1/context", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenant),
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ q: "Alex payments", limit: 5 }),
    }),
  );
  expect(context.context).toContain("Profile");
  expect(context.context).toContain("Stripe");

  const forgotten = await getJson<MemoryResponse>(
    await worker.fetch(`/v1/memories/${updated.id}`, {
      method: "DELETE",
      headers: {
        ...tenantHeaders(tenant),
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "test cleanup" }),
    }),
  );
  expect(forgotten.status).toBe("forgotten");

  const afterForget = await search(worker, tenant, {
    q: "Stripe Alex",
  });
  expect(afterForget.map((memory) => memory.id)).not.toContain(updated.id);

  const mcpTools = await getJson<JsonRpcResponse>(
    await worker.fetch("/mcp", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenant),
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "tools/list",
      }),
    }),
  );
  expect(JSON.stringify(mcpTools.result)).toContain("remember");
  expect(JSON.stringify(mcpTools.result)).toContain("recall");

  const mcpRemember = await getJson<JsonRpcResponse>(
    await worker.fetch("/mcp", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenant),
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            content: "The OpenMemory UI is served by the Worker.",
            tags: ["ui"],
          },
        },
      }),
    }),
  );
  expect(JSON.stringify(mcpRemember.result)).toContain("Stored");

  const mcpRecall = await getJson<JsonRpcResponse>(
    await worker.fetch("/mcp", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenant),
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "recall",
          arguments: { query: "Worker UI" },
        },
      }),
    }),
  );
  expect(JSON.stringify(mcpRecall.result)).toContain("OpenMemory UI");

  const dashboard = await worker.fetch("/");
  expect(dashboard.status).toBe(200);
  expect(await dashboard.text()).toContain("OpenMemory");
}, 45_000);

test("MCP streamable HTTP compatibility covers handshake and optional surfaces", async () => {
  const worker = await startWorker();
  workers.push(worker);

  const tenant = `mcp-compat-${crypto.randomUUID()}`;
  const headers = {
    ...tenantHeaders(tenant),
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };

  const initialized = await getJson<JsonRpcResponse>(
    await worker.fetch("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "init",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: {
            name: "openmemory-vitest-client",
            version: "0.0.0",
          },
        },
      }),
    }),
  );
  expect(initialized.error).toBeUndefined();
  expect(initialized.result).toMatchObject({
    serverInfo: {
      name: "openmemory",
    },
  });
  expect(JSON.stringify(initialized.result)).toContain("tools");

  const initializedNotification = await worker.fetch("/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    }),
  });
  expect(initializedNotification.status).toBeGreaterThanOrEqual(200);
  expect(initializedNotification.status).toBeLessThan(300);

  const tools = await getJson<JsonRpcResponse>(
    await worker.fetch("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "tools",
        method: "tools/list",
      }),
    }),
  );
  expect(tools.error).toBeUndefined();
  expect(JSON.stringify(tools.result)).toContain("remember");
  expect(JSON.stringify(tools.result)).toContain("recall");
  expect(JSON.stringify(tools.result)).toContain("profile");
  expect(JSON.stringify(tools.result)).toContain("forget");

  for (const method of ["resources/list", "prompts/list"]) {
    const response = await getJson<JsonRpcResponse>(
      await worker.fetch("/mcp", {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: method,
          method,
        }),
      }),
    );
    expect(response.result ?? response.error).toBeTruthy();
  }
}, 45_000);

test("worker emits operational headers and rate limits repeated requests", async () => {
  const worker = await startWorker({
    OPENMEMORY_RATE_LIMIT_PER_MINUTE: "2",
  });
  workers.push(worker);

  const tenant = `rate-limit-${crypto.randomUUID()}`;
  const first = await worker.fetch("/v1/memories", {
    headers: {
      ...tenantHeaders(tenant),
      authorization: "Bearer rate-limit-token",
    },
  });
  const second = await worker.fetch("/v1/memories", {
    headers: {
      ...tenantHeaders(tenant),
      authorization: "Bearer rate-limit-token",
    },
  });
  const third = await worker.fetch("/v1/memories", {
    headers: {
      ...tenantHeaders(tenant),
      authorization: "Bearer rate-limit-token",
    },
  });

  expect(first.status).toBe(200);
  expect(first.headers.get("x-openmemory-request-id")).toMatch(
    /^[\da-f-]{36}$/,
  );
  expect(first.headers.get("x-ratelimit-limit")).toBe("2");
  expect(first.headers.get("x-ratelimit-remaining")).toBe("1");
  expect(first.headers.get("x-ratelimit-scope")).toBe("global");
  expect(second.status).toBe(200);
  expect(second.headers.get("x-ratelimit-remaining")).toBe("0");
  expect(third.status).toBe(429);
  expect(third.headers.get("retry-after")).not.toBe("0");
  expect(await third.json()).toMatchObject({
    error: "rate_limited",
  });
}, 45_000);

test("worker API uses Better Auth session cookies as deployed tenant identity", async () => {
  const worker = await startWorker({
    BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-better-auth",
  });
  workers.push(worker);

  const email = `session-${crypto.randomUUID()}@example.com`;
  const signUp = await worker.fetch("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Session User",
      email,
      password: "password1234",
    }),
  });
  await expectOk(signUp);

  const cookie = getCookieHeader(signUp);
  expect(cookie).toContain("better-auth");

  const session = await getJson<SessionResponse>(
    await worker.fetch("/api/auth/get-session", {
      headers: { cookie },
    }),
  );
  expect(session.user.email).toBe(email);

  const oauthClient = await getJson<OAuthClientResponse>(
    await worker.fetch("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "OpenMemory OAuth Token Flow",
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "openid profile memory:read memory:write",
      }),
    }),
  );
  const codeVerifier = `openmemory-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const codeChallenge = await pkceChallenge(codeVerifier);
  const authorization = await getRedirectUrl(
    await worker.fetch(
      `/api/auth/oauth2/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: oauthClient.client_id,
        redirect_uri: "http://127.0.0.1/callback",
        scope: "openid profile memory:read memory:write",
        state: "oauth-smoke",
        prompt: "consent",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      })}`,
      {
        headers: { cookie, accept: "application/json" },
        redirect: "manual",
      },
    ),
  );
  const callback =
    authorization.pathname === "/consent"
      ? new URL(
          (
            await getJson<OAuthRedirectResponse>(
              await worker.fetch("/api/auth/oauth2/consent", {
                method: "POST",
                headers: {
                  cookie,
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
  expect(callback.searchParams.get("state")).toBe("oauth-smoke");
  const code = callback.searchParams.get("code");
  expect(code, callback.toString()).toBeTruthy();

  const connections = await getJson<OAuthConnectionResponse[]>(
    await worker.fetch("/v1/oauth/connections", {
      headers: { cookie },
    }),
  );
  expect(connections).toContainEqual(
    expect.objectContaining({
      clientId: oauthClient.client_id,
      name: "OpenMemory OAuth Token Flow",
      scopes: expect.arrayContaining(["memory:read", "memory:write"]),
    }),
  );

  const revoked = await getJson<OAuthRevokeResponse>(
    await worker.fetch(`/v1/oauth/connections/${oauthClient.client_id}`, {
      method: "DELETE",
      headers: { cookie },
    }),
  );
  expect(revoked).toEqual({
    clientId: oauthClient.client_id,
    revoked: true,
  });
  const afterRevoke = await getJson<OAuthConnectionResponse[]>(
    await worker.fetch("/v1/oauth/connections", {
      headers: { cookie },
    }),
  );
  expect(afterRevoke.map((connection) => connection.clientId)).not.toContain(
    oauthClient.client_id,
  );

  const memory = await getJson<MemoryResponse>(
    await worker.fetch("/v1/memories", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "Cookie sessions identify the OpenMemory tenant.",
        tags: ["auth"],
      }),
    }),
  );
  expect(memory.content).toContain("Cookie sessions");

  const memories = await getJson<MemoryResponse[]>(
    await worker.fetch("/v1/memories", {
      headers: { cookie },
    }),
  );
  expect(memories.map((item) => item.id)).toContain(memory.id);
}, 45_000);

test("ingestion extracts entities, links graph neighbors, and improves recall", async () => {
  const worker = await startWorker();
  workers.push(worker);

  const tenant = `tenant-rag-${crypto.randomUUID()}`;
  const anchor = await createMemory(worker, tenant, {
    content: "Boris maintains Graph Indexing for OpenMemory retrieval.",
    tags: ["architecture"],
  });

  const ingested = await getJson<IngestResponse>(
    await worker.fetch("/v1/ingest", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenant),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content:
          "Graph Indexing improves recall quality by expanding related memories.",
        source: "conversation",
      }),
    }),
  );
  expect(ingested.memory.entityIds).toContain("graph-indexing");
  expect(ingested.edges).toContainEqual(
    expect.objectContaining({
      sourceId: ingested.memory.id,
      targetId: anchor.id,
      relationship: "shares_entity",
    }),
  );

  const results = await search(worker, tenant, {
    q: "Boris",
    limit: 5,
  });
  expect(results).toContainEqual(
    expect.objectContaining({
      id: ingested.memory.id,
      reason: "graph",
    }),
  );
}, 45_000);

test("source ingestion chunks documents, preserves provenance, and links chunk graph", async () => {
  const worker = await startWorker();
  workers.push(worker);

  const tenant = `tenant-source-${crypto.randomUUID()}`;
  const anchor = await createMemory(worker, tenant, {
    content: "Boris maintains Graph Indexing for OpenMemory retrieval.",
    tags: ["architecture"],
  });

  const source = await getJson<SourceIngestResponse>(
    await worker.fetch("/v1/sources", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenant),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "OpenMemory architecture notes",
        source: "architecture-doc",
        tags: ["docs"],
        chunkSize: 450,
        overlap: 80,
        content: [
          "Graph Indexing is the retrieval strategy Boris uses to connect related OpenMemory memories.",
          "It links source chunks to canonical facts so recall can expand through Durable Object graph edges.",
          "Workers AI creates embeddings and Vectorize supplies semantic candidates when Cloudflare bindings are available.",
          "The RAG pipeline keeps graph currentness separate from raw document chunks so outdated facts can be superseded.",
          "Document ingestion should preserve provenance, source ids, chunk boundaries, titles, and relationships between adjacent chunks.",
          "Graph Indexing also helps a later query about Boris discover nearby source material even when the exact chunk does not mention every keyword.",
        ].join(" "),
      }),
    }),
  );

  expect(source.sourceId).toMatch(/^src_/);
  expect(source.chunkCount).toBeGreaterThan(1);
  expect(source.memories).toHaveLength(source.chunkCount);
  expect(source.memories[0]?.metadata).toMatchObject({
    sourceId: source.sourceId,
    title: "OpenMemory architecture notes",
    chunkIndex: 0,
    chunkCount: source.chunkCount,
  });
  expect(source.memories[0]?.metadata.ingestion).toMatchObject({
    strategy: "chunked-source-v1",
  });
  expect(source.edges).toContainEqual(
    expect.objectContaining({
      sourceId: source.memories[0]?.id,
      targetId: source.memories[1]?.id,
      relationship: "next_chunk",
    }),
  );
  expect(source.edges).toContainEqual(
    expect.objectContaining({
      targetId: anchor.id,
      relationship: "shares_entity",
    }),
  );
  const stats = await getJson<GraphStatsResponse>(
    await worker.fetch("/v1/graph/stats", {
      headers: tenantHeaders(tenant),
    }),
  );
  expect(stats.activeMemories).toBe(source.chunkCount + 1);
  expect(stats.totalEdges).toBeGreaterThanOrEqual(source.chunkCount);
  expect(stats.entityCount).toBeGreaterThan(0);

  const results = await search(worker, tenant, {
    q: "Workers AI Vectorize source chunks",
    limit: 5,
  });
  expect(
    results.some((result) => result.metadata.sourceId === source.sourceId),
  ).toBe(true);
}, 45_000);

test("async source ingestion queues a durable job and completes the graph pipeline", async () => {
  const worker = await startWorker();
  workers.push(worker);

  const tenant = `tenant-async-source-${crypto.randomUUID()}`;
  const anchor = await createMemory(worker, tenant, {
    content: "Boris maintains Graph Indexing for async OpenMemory retrieval.",
    tags: ["architecture"],
  });

  const queued = await getJson<SourceIngestJobResponse>(
    await worker.fetch("/v1/sources/async", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenant),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Async source notes",
        source: "async-architecture-doc",
        tags: ["docs", "async"],
        chunkSize: 450,
        overlap: 80,
        content: [
          "Graph Indexing connects queued source chunks with existing memories.",
          "Cloudflare Queues accepts the ingestion request before heavier chunking and embedding work starts.",
          "Cloudflare Workflows coordinates the durable processing step so retries do not lose source provenance.",
          "Boris should be discoverable through graph expansion after the async source job completes.",
        ].join(" "),
      }),
    }),
  );

  expect(queued.sourceId).toMatch(/^src_/);
  expect(queued.status).toBe("queued");
  expect(queued.metadata).toMatchObject({
    strategy: "queue-workflow-source-ingestion-v1",
  });

  const completed = await waitForSourceJob(worker, tenant, queued.sourceId);
  expect(completed.status).toBe("completed");
  expect(completed.result).toMatchObject({
    sourceId: queued.sourceId,
  });
  expect(completed.result?.chunkCount).toBeGreaterThan(0);
  expect(completed.result?.memoryIds.length).toBe(completed.result?.chunkCount);

  const neighbors = await getJson<EdgeResponse[]>(
    await worker.fetch(`/v1/graph/${anchor.id}/neighbors`, {
      headers: tenantHeaders(tenant),
    }),
  );
  expect(neighbors).toContainEqual(
    expect.objectContaining({
      targetId: anchor.id,
      relationship: "shares_entity",
    }),
  );

  const results = await search(worker, tenant, {
    q: "queued durable workflows source provenance",
    limit: 5,
  });
  expect(
    results.some((result) => result.metadata.sourceId === queued.sourceId),
  ).toBe(true);
}, 60_000);

test("recall benchmark preserves ranking quality across direct and graph retrieval", async () => {
  const worker = await startWorker();
  workers.push(worker);

  const tenant = `tenant-benchmark-${crypto.randomUUID()}`;
  const targets = [
    await createMemory(worker, tenant, {
      content: "Maya prefers concise TypeScript code reviews.",
      tags: ["people", "reviews"],
      importance: 0.9,
    }),
    await createMemory(worker, tenant, {
      content: "The Atlas launch decision was moved to Tuesday.",
      tags: ["projects", "launch"],
      importance: 0.85,
    }),
    await createMemory(worker, tenant, {
      content: "Boris maintains Graph Indexing for OpenMemory retrieval.",
      tags: ["architecture"],
      importance: 0.8,
    }),
    await createMemory(worker, tenant, {
      content: "Nina prefers morning standups with written agendas.",
      tags: ["people", "meetings"],
      type: "preference",
      importance: 0.82,
    }),
    await createMemory(worker, tenant, {
      content: "The Hermes ingestion workflow exports graph backups to R2.",
      tags: ["projects", "ingestion"],
      type: "decision",
      importance: 0.88,
    }),
    await createMemory(worker, tenant, {
      content:
        "OpenMemory source chunks preserve title and chunk index metadata.",
      tags: ["docs", "sources"],
      importance: 0.78,
    }),
  ];

  await getJson<IngestResponse>(
    await worker.fetch("/v1/ingest", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenant),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content:
          "Graph Indexing expands related OpenMemory memories during recall.",
        source: "benchmark",
      }),
    }),
  );

  await createMemory(worker, tenant, {
    content: "The coffee machine requires descaling every Friday.",
    tags: ["ops"],
  });
  await createMemory(worker, tenant, {
    content: "Atlas coffee chat moved to Thursday.",
    tags: ["distractor"],
  });
  await createMemory(worker, tenant, {
    content: "Hermes courier schedule is unrelated to graph exports.",
    tags: ["distractor"],
  });

  const cases = [
    { query: "Maya TypeScript review preference", targetId: targets[0].id },
    { query: "Atlas launch moved day", targetId: targets[1].id },
    { query: "Boris retrieval", targetId: targets[2].id },
    { query: "Nina standup agenda preference", targetId: targets[3].id },
    { query: "Hermes graph backup export target", targetId: targets[4].id },
    { query: "source chunk title index metadata", targetId: targets[5].id },
  ];

  const reciprocalRanks = await Promise.all(
    cases.map(async (benchmarkCase) => {
      const results = await search(worker, tenant, {
        q: benchmarkCase.query,
        limit: 5,
      });
      return reciprocalRank(results, benchmarkCase.targetId);
    }),
  );
  const meanReciprocalRank =
    reciprocalRanks.reduce((total, rank) => total + rank, 0) /
    reciprocalRanks.length;

  expect(meanReciprocalRank).toBeGreaterThanOrEqual(0.8);
}, 45_000);

test("deterministic reranker prefers important and confident current memories", async () => {
  const worker = await startWorker();
  workers.push(worker);

  const tenant = `tenant-rerank-${crypto.randomUUID()}`;
  const lowSignal = await createMemory(worker, tenant, {
    content: "Atlas launch owner is Riley.",
    tags: ["atlas"],
    confidence: 0.2,
    importance: 0.1,
  });
  const highSignal = await createMemory(worker, tenant, {
    content: "Atlas launch owner is Morgan.",
    tags: ["atlas"],
    confidence: 0.95,
    importance: 0.95,
  });

  const results = await search(worker, tenant, {
    q: "Atlas launch owner",
    limit: 2,
  });

  expect(results.map((result) => result.id)).toEqual([
    highSignal.id,
    lowSignal.id,
  ]);
}, 45_000);

test("graph stats and recall stay bounded on a moderate local graph", async () => {
  const worker = await startWorker();
  workers.push(worker);

  const tenant = `tenant-scale-${crypto.randomUUID()}`;
  const topics = ["Atlas", "Borealis", "Cosmos", "Delta"];
  const graphSize = 120;
  for (let index = 0; index < graphSize; index += 1) {
    const topic = topics[index % topics.length];
    await createMemory(worker, tenant, {
      content: `${topic} project memory ${index}: Graph Indexing connects source chunks, decisions, and retrieval notes.`,
      tags: ["scale", topic.toLowerCase()],
      importance: index % 10 === 0 ? 0.9 : 0.5,
    });
  }

  const stats = await getJson<GraphStatsResponse>(
    await worker.fetch("/v1/graph/stats", {
      headers: tenantHeaders(tenant),
    }),
  );
  expect(stats.activeMemories).toBe(graphSize);
  expect(stats.totalMemories).toBe(graphSize);
  expect(stats.tagCount).toBeGreaterThanOrEqual(5);

  const startedAt = performance.now();
  const results = await search(worker, tenant, {
    q: "Atlas Graph Indexing retrieval notes",
    limit: 10,
  });
  const elapsedMs = performance.now() - startedAt;

  expect(results).toHaveLength(10);
  expect(results[0]?.content).toContain("Atlas");
  expect(elapsedMs).toBeLessThan(7_500);
}, 45_000);

test("auth helpers keep tenant headers local-only", () => {
  const local = new Request("http://127.0.0.1:54150/v1/memories");
  const deployed = new Request("https://openmemory.example/v1/memories");

  expect(isLocalDevelopmentRequest(local)).toBe(true);
  expect(isLocalDevelopmentRequest(deployed)).toBe(false);

  expect(
    resolveTenant(tenantHeaders("local-user"), {
      allowHeaderTenant: isLocalDevelopmentRequest(local),
    }),
  ).toEqual({ tenantId: "local-user" });

  expect(
    resolveTenant(tenantHeaders("deployed-user"), {
      allowHeaderTenant: isLocalDevelopmentRequest(deployed),
    }),
  ).toMatchObject({
    error: "header_tenant_disabled",
  });
});

async function startWorker(env: Record<string, string> = {}) {
  const port = await getAvailablePort();
  const inspectorPort = await getAvailablePort();
  await mkdir(testTmpRoot, { recursive: true });
  const persistTo = await mkdtemp(join(testTmpRoot, "wrangler-state-"));
  const output: string[] = [];
  await applyLocalMigrations(persistTo);

  const proc = spawn(
    "bun",
    [
      "run",
      "--cwd",
      "apps/api",
      "wrangler",
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
      "--persist-to",
      persistTo,
      ...Object.entries(env).flatMap(([key, value]) => [
        "--var",
        `${key}:${value}`,
      ]),
      "--log-level",
      "info",
      "--show-interactive-dev-session=false",
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        NO_COLOR: "1",
        TMPDIR: existsSync("/Volumes/CrucialX10")
          ? "/Volumes/CrucialX10/tmp/openmemory-bun-tmp"
          : tmpdir(),
        WRANGLER_SEND_METRICS: "false",
        XDG_CONFIG_HOME: existsSync("/Volumes/CrucialX10")
          ? "/Volumes/CrucialX10/tmp/openmemory-xdg"
          : join(tmpdir(), "openmemory-xdg"),
      },
    },
  );

  collectOutput(proc.stdout, output);
  collectOutput(proc.stderr, output);

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, proc, output);

  return {
    baseUrl,
    fetch: async (path: string, init?: RequestInit) => {
      const response = await fetch(
        `${baseUrl}${path}`,
        withTimeout(init, 10_000),
      );
      if (response.status >= 500) {
        console.error(
          `Worker returned ${response.status} for ${path}:\n${output.join("")}`,
        );
      }
      return response;
    },
    stop: async () => {
      proc.kill("SIGTERM");
      await Promise.race([waitForExit(proc), sleep(3_000)]);
      if (proc.exitCode === null) {
        proc.kill("SIGKILL");
        await waitForExit(proc);
      }
      await rm(persistTo, { force: true, recursive: true });
    },
  };
}

type WorkerProcess = Awaited<ReturnType<typeof startWorker>>;

async function createMemory(
  worker: WorkerProcess,
  tenantId: string,
  body: Record<string, unknown>,
) {
  const response = await worker.fetch("/v1/memories", {
    method: "POST",
    headers: {
      ...tenantHeaders(tenantId),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  return getJson<MemoryResponse>(response);
}

async function addEdge(
  worker: WorkerProcess,
  tenantId: string,
  body: Record<string, unknown>,
) {
  const response = await worker.fetch("/v1/graph/edges", {
    method: "POST",
    headers: {
      ...tenantHeaders(tenantId),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  return getJson<EdgeResponse>(response);
}

async function search(
  worker: WorkerProcess,
  tenantId: string,
  body: Record<string, unknown>,
) {
  return getJson<SearchResponse[]>(
    await worker.fetch("/v1/search", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenantId),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}

async function waitForSourceJob(
  worker: WorkerProcess,
  tenantId: string,
  sourceId: string,
) {
  const startedAt = Date.now();
  let latest: SourceIngestJobResponse | undefined;

  while (Date.now() - startedAt < 30_000) {
    latest = await getJson<SourceIngestJobResponse>(
      await worker.fetch(`/v1/sources/${sourceId}`, {
        headers: tenantHeaders(tenantId),
      }),
    );

    if (latest.status === "completed") {
      return latest;
    }
    if (latest.status === "failed") {
      throw new Error(
        `Async source ingestion failed: ${JSON.stringify(latest)}`,
      );
    }

    await sleep(500);
  }

  throw new Error(
    `Timed out waiting for source ingestion job: ${JSON.stringify(latest)}`,
  );
}

function tenantHeaders(tenantId: string) {
  return { "x-openmemory-user-id": tenantId };
}

async function getJson<T>(response: Response) {
  await expectOk(response.clone());
  return (await response.json()) as T;
}

async function getRedirectUrl(response: Response) {
  const location = response.headers.get("location");
  if (location) {
    return new URL(location, "http://127.0.0.1");
  }

  const body = await getJson<OAuthRedirectResponse>(response);
  return new URL(body.url, "http://127.0.0.1");
}

async function expectOk(response: Response) {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Expected 2xx response, got ${response.status}:\n${await response.text()}`,
    );
  }
}

async function waitForHealth(
  baseUrl: string,
  proc: ChildProcessWithoutNullStreams,
  output: string[],
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (proc.exitCode !== null) {
      throw new Error(`Wrangler exited early:\n${output.join("")}`);
    }

    try {
      const response = await fetch(`${baseUrl}/health`, withTimeout({}, 1_000));
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until Wrangler binds the randomized port.
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for Wrangler:\n${output.join("")}`);
}

async function getAvailablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate local port")));
        return;
      }

      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function collectOutput(
  stream: NodeJS.ReadableStream | null,
  output: string[],
) {
  if (!stream) {
    return;
  }

  stream.on("data", (chunk) => output.push(String(chunk)));
}

async function applyLocalMigrations(persistTo: string) {
  const output: string[] = [];
  const proc = spawn(
    "bun",
    [
      "run",
      "--cwd",
      "apps/api",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "openmemory-auth",
      "--local",
      "--persist-to",
      persistTo,
      "--config",
      "wrangler.jsonc",
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        NO_COLOR: "1",
        WRANGLER_SEND_METRICS: "false",
      },
    },
  );
  collectOutput(proc.stdout, output);
  collectOutput(proc.stderr, output);
  await waitForExit(proc);

  if (proc.exitCode !== 0) {
    throw new Error(`Could not apply local D1 migrations:\n${output.join("")}`);
  }
}

function getCookieHeader(response: Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookie = headers.getSetCookie?.() ?? [];
  const cookieParts = (
    setCookie.length > 0
      ? setCookie
      : splitSetCookieHeader(response.headers.get("set-cookie") ?? "")
  )
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean);

  return cookieParts.join("; ");
}

function splitSetCookieHeader(value: string) {
  if (!value) {
    return [];
  }

  return value.split(/,(?=\s*[^;,]+=)/);
}

function reciprocalRank(results: SearchResponse[], targetId: string) {
  const index = results.findIndex((result) => result.id === targetId);
  return index === -1 ? 0 : 1 / (index + 1);
}

async function pkceChallenge(verifier: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(hash);
}

function base64Url(buffer: ArrayBuffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(proc: ChildProcessWithoutNullStreams) {
  if (proc.exitCode !== null) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
  });
}

function withTimeout(init: RequestInit = {}, timeoutMs: number): RequestInit {
  if (init.signal) {
    return init;
  }

  return {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  };
}

type MemoryResponse = {
  id: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  type: string;
  status: string;
  isLatest: boolean;
  entityIds: string[];
  supersedesId?: string;
};

type SearchResponse = MemoryResponse & {
  reason: "semantic" | "keyword" | "graph";
  score: number;
};

type EdgeResponse = {
  sourceId: string;
  targetId: string;
  relationship: string;
  weight: number;
  metadata: Record<string, unknown>;
};

type ProfileResponse = {
  summary: string;
};

type ContextResponse = {
  context: string;
};

type JsonRpcResponse = {
  result?: unknown;
  error?: unknown;
};

type OAuthMetadataResponse = {
  issuer: string;
  authorization_endpoint: string;
  registration_endpoint: string;
  scopes_supported: string[];
};

type ProtectedResourceMetadataResponse = {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
};

type OAuthClientResponse = {
  client_id: string;
  token_endpoint_auth_method: string;
};

type OAuthRedirectResponse = {
  url: string;
};

type OAuthConnectionResponse = {
  clientId: string;
  name: string;
  scopes: string[];
};

type OAuthRevokeResponse = {
  clientId: string;
  revoked: boolean;
};

type SessionResponse = {
  user: {
    id: string;
    email: string;
  };
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

type SourceIngestJobResponse = {
  sourceId: string;
  status: "queued" | "processing" | "completed" | "failed";
  metadata: Record<string, unknown>;
  result?: {
    sourceId: string;
    chunkCount: number;
    memoryIds: string[];
    edgeCount: number;
  };
  error?: Record<string, unknown>;
};

type GraphStatsResponse = {
  totalMemories: number;
  activeMemories: number;
  historicalMemories: number;
  forgottenMemories: number;
  totalEdges: number;
  relationshipCount: number;
  entityCount: number;
  tagCount: number;
  generatedAt: string;
};

type GraphExportResponse = {
  key: string;
  bytes: number;
  memoryCount: number;
  edgeCount: number;
  writtenToR2: boolean;
};

type IndexRepairResponse = {
  attempted: number;
  tenantId: string;
  vectorizeConfigured: boolean;
};
