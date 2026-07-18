import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, test } from "vitest";
import { isLocalDevelopmentRequest, resolveTenant } from "../src/auth";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRoot = join(repoRoot, "apps/api");
const wranglerBin = join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
);
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

  const defaultWeightedEdge = await addEdge(worker, tenantA, {
    sourceId: memoryB.id,
    targetId: memoryA.id,
    relationship: "supports",
    metadata: { reason: "retrieval depends on canonical storage" },
  });
  expect(defaultWeightedEdge.weight).toBe(0.72);
  await addEdge(worker, tenantA, {
    sourceId: memoryB.id,
    targetId: memoryA.id,
    relationship: "supports",
    weight: 0.8,
    metadata: { reason: "idempotent replacement" },
  });
  const invalidEdge = await worker.fetch("/v1/graph/edges", {
    method: "POST",
    headers: {
      ...tenantHeaders(tenantA),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sourceId: memoryB.id,
      targetId: memoryA.id,
      relationship: "maybe_related",
    }),
  });
  expect(invalidEdge.status).toBe(422);
  expect(await invalidEdge.json()).toMatchObject({
    error: "invalid_graph_edge",
  });

  const relationshipCatalog = await getJson<GraphRelationshipResponse[]>(
    await worker.fetch("/v1/graph/relationships", {
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(relationshipCatalog).toContainEqual(
    expect.objectContaining({
      relationship: "supports",
      category: "causal",
      defaultWeight: 0.72,
    }),
  );

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
  const graphExportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    memories: [memoryA, memoryB],
    edges: [matchingEdges[0]],
  };
  expect(matchingEdges[0]?.metadata).toMatchObject({
    relationshipCategory: "causal",
    relationshipDirection: "forward",
  });

  const stats = await getJson<GraphStatsResponse>(
    await worker.fetch("/v1/graph/stats", {
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(stats.relationshipDistribution).toContainEqual(
    expect.objectContaining({
      relationship: "supports",
      category: "causal",
      count: 1,
    }),
  );
  expect(stats.graphDensity).toBeGreaterThan(0);

  const readiness = await getJson<ReadinessResponse>(
    await worker.fetch("/v1/readiness", {
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(readiness).toMatchObject({
    service: "openmemory-api",
    tenant: {
      id: tenantA,
      source: "local-header",
      localDevelopment: true,
    },
    graph: {
      activeMemories: 2,
      totalEdges: 1,
    },
    relationships: {
      catalogSize: expect.any(Number),
    },
    bindings: {
      durableObjects: true,
    },
    auth: {
      mode: "local-development-header",
    },
    mcp: {
      endpoint: `${worker.baseUrl}/mcp`,
    },
    rerank: {
      configured: false,
      workersAiConfigured: true,
      timeoutMs: 900,
      status: "disabled",
    },
  });
  expect(readiness.relationships.catalogSize).toBeGreaterThan(8);
  expect(readiness.rateLimit.limitPerMinute).toBeGreaterThan(0);
  expect(JSON.stringify(readiness)).not.toContain("test-secret");

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

  const replacePreviewPayload = {
    ...graphExportPayload,
    memories: [memoryA],
    edges: [],
  };
  const replacePreview = await getJson<GraphImportPreviewResponse>(
    await worker.fetch("/v1/imports/preview", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenantA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        confirmTenantId: tenantA,
        mode: "replace",
        export: replacePreviewPayload,
      }),
    }),
  );
  expect(replacePreview).toMatchObject({
    tenantId: tenantA,
    mode: "replace",
    version: 1,
    incoming: {
      memories: 1,
      edges: 0,
    },
    existing: {
      memories: 2,
      edges: 1,
    },
    impact: {
      memoriesImported: 1,
      memoriesSkipped: 0,
      edgesImported: 0,
      wouldDelete: {
        memories: 2,
        edges: 1,
      },
      wouldReplace: true,
    },
  });
  expect(replacePreview.candidates.newMemoryIds).toEqual([]);
  const afterReplacePreviewStats = await getJson<GraphStatsResponse>(
    await worker.fetch("/v1/graph/stats", {
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(afterReplacePreviewStats).toMatchObject({
    activeMemories: 2,
    totalMemories: 2,
    totalEdges: 1,
  });

  const tenantBExport = await getJson<GraphExportResponse>(
    await worker.fetch("/v1/exports", {
      method: "POST",
      headers: tenantHeaders(tenantB),
    }),
  );
  expect(tenantBExport.key).toContain(`${tenantB}/exports/`);

  const updatedMemoryB = await getJson<MemoryResponse>(
    await worker.fetch(`/v1/memories/${memoryB.id}`, {
      method: "PATCH",
      headers: {
        ...tenantHeaders(tenantA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "Vectorize repair removes superseded semantic candidates.",
        relationship: "updates",
        tags: ["retrieval"],
      }),
    }),
  );
  expect(updatedMemoryB.id).not.toBe(memoryB.id);

  const repair = await getJson<IndexRepairResponse>(
    await worker.fetch("/v1/index/repair", {
      method: "POST",
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(repair).toMatchObject({
    attempted: 2,
    expectedVectors: 2,
    purgeableMemories: 1,
    semanticIndex: {
      expectedVectors: 2,
      staleVectorCandidates: 1,
      status: "unchecked",
    },
    staleVectors: {
      attempted: 1,
      vectorizeConfigured: true,
    },
    tenantId: tenantA,
    vectorizeConfigured: true,
  });

  const mismatchPurge = await worker.fetch("/v1/tenant", {
    method: "DELETE",
    headers: {
      ...tenantHeaders(tenantA),
      "content-type": "application/json",
    },
    body: JSON.stringify({ confirmTenantId: tenantB }),
  });
  expect(mismatchPurge.status).toBe(409);
  expect(await mismatchPurge.json()).toMatchObject({
    error: "tenant_confirmation_mismatch",
  });

  const untouchedTenantMemory = await createMemory(worker, tenantB, {
    content: "Tenant B memory survives Tenant A purge.",
    tags: ["isolation"],
  });
  const purge = await getJson<TenantPurgeResponse>(
    await worker.fetch("/v1/tenant", {
      method: "DELETE",
      headers: {
        ...tenantHeaders(tenantA),
        "content-type": "application/json",
      },
      body: JSON.stringify({ confirmTenantId: tenantA }),
    }),
  );
  expect(purge).toMatchObject({
    tenantId: tenantA,
    memoriesDeleted: 3,
    edgesDeleted: 2,
    vectorIndex: {
      attempted: 3,
    },
    exports: {
      prefix: `${tenantA}/exports/`,
      attempted: 1,
      deleted: 1,
      failed: 0,
    },
  });
  expect(typeof purge.vectorIndex.vectorizeConfigured).toBe("boolean");
  expect(typeof purge.exports.r2Configured).toBe("boolean");

  const purgedList = await getJson<MemoryResponse[]>(
    await worker.fetch("/v1/memories", {
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(purgedList).toEqual([]);
  const purgedStats = await getJson<GraphStatsResponse>(
    await worker.fetch("/v1/graph/stats", {
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(purgedStats).toMatchObject({
    activeMemories: 0,
    totalMemories: 0,
    totalEdges: 0,
    entityCount: 0,
    tagCount: 0,
  });
  const mismatchedPreview = await worker.fetch("/v1/imports/preview", {
    method: "POST",
    headers: {
      ...tenantHeaders(tenantA),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      confirmTenantId: tenantB,
      mode: "replace",
      export: graphExportPayload,
    }),
  });
  expect(mismatchedPreview.status).toBe(409);
  expect(await mismatchedPreview.json()).toMatchObject({
    error: "tenant_confirmation_mismatch",
  });
  const mismatchedImport = await worker.fetch("/v1/imports", {
    method: "POST",
    headers: {
      ...tenantHeaders(tenantA),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      confirmTenantId: tenantB,
      mode: "replace",
      export: graphExportPayload,
    }),
  });
  expect(mismatchedImport.status).toBe(409);
  expect(await mismatchedImport.json()).toMatchObject({
    error: "tenant_confirmation_mismatch",
  });
  const invalidImport = await worker.fetch("/v1/imports", {
    method: "POST",
    headers: {
      ...tenantHeaders(tenantA),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      confirmTenantId: tenantA,
      mode: "replace",
      export: { version: 1, exportedAt: new Date().toISOString() },
    }),
  });
  expect(invalidImport.status).toBe(400);
  expect(await invalidImport.json()).toMatchObject({
    error: "invalid_graph_export",
  });
  const invalidPreview = await worker.fetch("/v1/imports/preview", {
    method: "POST",
    headers: {
      ...tenantHeaders(tenantA),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      confirmTenantId: tenantA,
      mode: "replace",
      export: { version: 1, exportedAt: new Date().toISOString() },
    }),
  });
  expect(invalidPreview.status).toBe(400);
  expect(await invalidPreview.json()).toMatchObject({
    error: "invalid_graph_export",
  });
  const danglingPreview = await worker.fetch("/v1/imports/preview", {
    method: "POST",
    headers: {
      ...tenantHeaders(tenantA),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      confirmTenantId: tenantA,
      mode: "merge",
      export: {
        ...graphExportPayload,
        edges: [
          {
            ...matchingEdges[0],
            sourceId: memoryA.id,
            targetId: "missing-memory",
          },
        ],
      },
    }),
  });
  expect(danglingPreview.status).toBe(400);
  expect(await danglingPreview.json()).toMatchObject({
    error: "graph_import_failed",
    message: "graph_export_contains_dangling_edges",
  });
  const danglingMerge = await worker.fetch("/v1/imports", {
    method: "POST",
    headers: {
      ...tenantHeaders(tenantA),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      confirmTenantId: tenantA,
      mode: "merge",
      export: {
        ...graphExportPayload,
        edges: [
          {
            ...matchingEdges[0],
            sourceId: memoryA.id,
            targetId: "missing-memory",
          },
        ],
      },
    }),
  });
  expect(danglingMerge.status).toBe(400);
  expect(await danglingMerge.json()).toMatchObject({
    error: "graph_import_failed",
    message: "graph_export_contains_dangling_edges",
  });
  const restored = await getJson<GraphImportResponse>(
    await worker.fetch("/v1/imports", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenantA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        confirmTenantId: tenantA,
        mode: "replace",
        export: graphExportPayload,
      }),
    }),
  );
  expect(restored).toMatchObject({
    tenantId: tenantA,
    mode: "replace",
    version: 1,
    memoriesImported: 2,
    edgesImported: 1,
    activeMemoriesIndexed: 2,
    replaced: {
      memoriesDeleted: 0,
      edgesDeleted: 0,
      vectorIndex: {
        attempted: 0,
      },
    },
  });
  const restoredList = await getJson<MemoryResponse[]>(
    await worker.fetch("/v1/memories", {
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(restoredList.map((memory) => memory.id).sort()).toEqual(
    [memoryA.id, memoryB.id].sort(),
  );
  const restoredNeighbors = await getJson<EdgeResponse[]>(
    await worker.fetch(`/v1/graph/${memoryA.id}/neighbors`, {
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(restoredNeighbors).toContainEqual(
    expect.objectContaining({
      sourceId: memoryB.id,
      targetId: memoryA.id,
      relationship: "supports",
      weight: 0.8,
    }),
  );
  const mergedMemory = {
    ...memoryA,
    id: `mem_merge_${crypto.randomUUID().replace(/-/g, "")}`,
    content: "Merged graph imports should preserve existing memories.",
    tags: ["merge"],
    metadata: { merged: true },
    entityIds: ["merged-graph"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const changedMemoryA = {
    ...memoryA,
    content: "Memory A was intentionally overwritten during graph restore.",
    tags: ["restored", "overwrite"],
    metadata: { restored: true },
    entityIds: ["restored-memory-a"],
    updatedAt: new Date().toISOString(),
  };
  const mergePayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    memories: [changedMemoryA, mergedMemory],
    edges: [
      {
        ...matchingEdges[0],
        sourceId: mergedMemory.id,
        targetId: memoryA.id,
        relationship: "extends",
        weight: 0.7,
      },
    ],
  };
  const mergePreview = await getJson<GraphImportPreviewResponse>(
    await worker.fetch("/v1/imports/preview", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenantA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        confirmTenantId: tenantA,
        mode: "merge",
        export: mergePayload,
      }),
    }),
  );
  expect(mergePreview).toMatchObject({
    tenantId: tenantA,
    mode: "merge",
    conflictPolicy: "skip",
    version: 1,
    incoming: {
      memories: 2,
      edges: 1,
    },
    existing: {
      memories: 2,
      edges: 1,
    },
    impact: {
      memoriesImported: 1,
      memoriesSkipped: 1,
      memoriesOverwritten: 0,
      edgesImported: 1,
      wouldDelete: {
        memories: 0,
        edges: 0,
      },
      wouldReplace: false,
    },
    conflicts: {
      duplicateMemoryIds: [memoryA.id],
      duplicateMemoryIdsTruncated: false,
      changedMemoryIds: [memoryA.id],
      changedMemoryIdsTruncated: false,
      unchangedMemoryIds: [],
      unchangedMemoryIdsTruncated: false,
      fieldConflicts: [
        {
          id: memoryA.id,
          fields: ["content", "tags", "metadata", "entityIds"],
        },
      ],
      fieldConflictsTruncated: false,
    },
    candidates: {
      newMemoryIds: [mergedMemory.id],
      newMemoryIdsTruncated: false,
    },
  });
  const merged = await getJson<GraphImportResponse>(
    await worker.fetch("/v1/imports", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenantA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        confirmTenantId: tenantA,
        mode: "merge",
        export: mergePayload,
      }),
    }),
  );
  expect(merged).toMatchObject({
    tenantId: tenantA,
    mode: "merge",
    version: 1,
    memoriesImported: 1,
    memoriesSkipped: 1,
    memoriesOverwritten: 0,
    edgesImported: 1,
    activeMemoriesIndexed: 1,
    merged: {
      memoriesSkipped: 1,
      memoriesOverwritten: 0,
    },
  });
  const mergedList = await getJson<MemoryResponse[]>(
    await worker.fetch("/v1/memories", {
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(mergedList.map((memory) => memory.id).sort()).toEqual(
    [memoryA.id, memoryB.id, mergedMemory.id].sort(),
  );
  const skippedDuplicate = await getJson<MemoryResponse>(
    await worker.fetch(`/v1/memories/${memoryA.id}`, {
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(skippedDuplicate.content).toBe(memoryA.content);
  expect(skippedDuplicate.tags).toEqual(memoryA.tags);
  const mergedNeighbors = await getJson<EdgeResponse[]>(
    await worker.fetch(`/v1/graph/${memoryA.id}/neighbors`, {
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(mergedNeighbors).toContainEqual(
    expect.objectContaining({
      sourceId: mergedMemory.id,
      targetId: memoryA.id,
      relationship: "extends",
      weight: 0.7,
    }),
  );
  const overwritePreview = await getJson<GraphImportPreviewResponse>(
    await worker.fetch("/v1/imports/preview", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenantA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        confirmTenantId: tenantA,
        mode: "merge",
        conflictPolicy: "overwrite",
        export: {
          version: 1,
          exportedAt: new Date().toISOString(),
          memories: [changedMemoryA],
          edges: [],
        },
      }),
    }),
  );
  expect(overwritePreview).toMatchObject({
    tenantId: tenantA,
    mode: "merge",
    conflictPolicy: "overwrite",
    impact: {
      memoriesImported: 0,
      memoriesSkipped: 0,
      memoriesOverwritten: 1,
      edgesImported: 0,
    },
    conflicts: {
      changedMemoryIds: [memoryA.id],
    },
  });
  const overwritten = await getJson<GraphImportResponse>(
    await worker.fetch("/v1/imports", {
      method: "POST",
      headers: {
        ...tenantHeaders(tenantA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        confirmTenantId: tenantA,
        mode: "merge",
        conflictPolicy: "overwrite",
        export: {
          version: 1,
          exportedAt: new Date().toISOString(),
          memories: [changedMemoryA],
          edges: [],
        },
      }),
    }),
  );
  expect(overwritten).toMatchObject({
    tenantId: tenantA,
    mode: "merge",
    memoriesImported: 0,
    memoriesSkipped: 0,
    memoriesOverwritten: 1,
    edgesImported: 0,
    activeMemoriesIndexed: 1,
    merged: {
      memoriesSkipped: 0,
      memoriesOverwritten: 1,
    },
  });
  const overwrittenMemory = await getJson<MemoryResponse>(
    await worker.fetch(`/v1/memories/${memoryA.id}`, {
      headers: tenantHeaders(tenantA),
    }),
  );
  expect(overwrittenMemory).toMatchObject({
    id: memoryA.id,
    content: changedMemoryA.content,
    tags: changedMemoryA.tags,
    metadata: changedMemoryA.metadata,
    entityIds: changedMemoryA.entityIds,
  });
  const tenantBListAfterPurge = await getJson<MemoryResponse[]>(
    await worker.fetch("/v1/memories", {
      headers: tenantHeaders(tenantB),
    }),
  );
  expect(tenantBListAfterPurge.map((memory) => memory.id)).toContain(
    untouchedTenantMemory.id,
  );
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
  const dashboardHtml = await dashboard.text();
  expect(dashboardHtml).toContain("Memory Dashboard");
  expect(dashboardHtml).toContain("Operations");
  expect(dashboardHtml).toContain("/assets/");
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

  const remember = await getJson<JsonRpcResponse>(
    await worker.fetch("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "remember",
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            content:
              "MCP resources and prompts expose OpenMemory launch context.",
            tags: ["mcp", "resources"],
            type: "fact",
          },
        },
      }),
    }),
  );
  expect(JSON.stringify(remember.result)).toContain("Stored");

  const resources = await getJson<JsonRpcResponse>(
    await worker.fetch("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "resources",
        method: "resources/list",
      }),
    }),
  );
  expect(resources.error).toBeUndefined();
  expect(JSON.stringify(resources.result)).toContain("openmemory://profile");
  expect(JSON.stringify(resources.result)).toContain("openmemory://recent");

  for (const uri of ["openmemory://profile", "openmemory://recent"]) {
    const resource = await getJson<JsonRpcResponse>(
      await worker.fetch("/mcp", {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: uri,
          method: "resources/read",
          params: { uri },
        }),
      }),
    );
    expect(resource.error).toBeUndefined();
    expect(JSON.stringify(resource.result)).toContain("launch context");
  }

  const prompts = await getJson<JsonRpcResponse>(
    await worker.fetch("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "prompts",
        method: "prompts/list",
      }),
    }),
  );
  expect(prompts.error).toBeUndefined();
  expect(JSON.stringify(prompts.result)).toContain("context");

  const contextPrompt = await getJson<JsonRpcResponse>(
    await worker.fetch("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "context-prompt",
        method: "prompts/get",
        params: {
          name: "context",
          arguments: {
            query: "launch context",
            limit: "5",
          },
        },
      }),
    }),
  );
  expect(contextPrompt.error).toBeUndefined();
  expect(JSON.stringify(contextPrompt.result)).toContain("launch context");
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

  const readiness = await getJson<ReadinessResponse>(
    await worker.fetch("/v1/readiness", {
      headers: { cookie },
    }),
  );
  expect(readiness).toMatchObject({
    service: "openmemory-api",
    tenant: {
      id: session.user.id.toLowerCase(),
      source: "session",
    },
    auth: {
      mode: "session",
    },
    graph: {
      totalMemories: 1,
    },
    mcp: {
      authorizationServer: `${worker.baseUrl}/.well-known/oauth-authorization-server/api/auth`,
      protectedResource: `${worker.baseUrl}/.well-known/oauth-protected-resource/mcp`,
      tools: expect.arrayContaining([
        "remember",
        "recall",
        "profile",
        "forget",
      ]),
    },
  });
  expect(readiness.bindings.authDb).toBe(true);
  expect(readiness.rerank.status).toBe("disabled");
}, 45_000);

test("worker API manages account workspace and team members", async () => {
  const worker = await startWorker({
    BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-better-auth",
  });
  workers.push(worker);

  const email = `workspace-${crypto.randomUUID()}@example.com`;
  const signUp = await worker.fetch("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Workspace Owner",
      email,
      password: "password1234",
    }),
  });
  await expectOk(signUp);
  const cookie = getCookieHeader(signUp);

  const account = await getJson<AccountResponse>(
    await worker.fetch("/v1/account", {
      headers: { cookie },
    }),
  );
  expect(account.user.email).toBe(email);
  expect(account.user.name).toBe("Workspace Owner");
  expect(account.workspace.tenantId).toBe(account.user.id.toLowerCase());
  expect(account.members).toContainEqual(
    expect.objectContaining({
      email,
      role: "owner",
      status: "active",
      userId: account.user.id,
    }),
  );

  const renamed = await getJson<AccountResponse>(
    await worker.fetch("/v1/account/workspace", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Research Memory Team" }),
    }),
  );
  expect(renamed.workspace.name).toBe("Research Memory Team");

  const updatedProfile = await getJson<AccountResponse>(
    await worker.fetch("/v1/account/profile", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Research Lead" }),
    }),
  );
  expect(updatedProfile.user.name).toBe("Research Lead");

  const inviteEmail = `teammate-${crypto.randomUUID()}@example.com`;
  const invited = await getJson<WorkspaceMemberResponse>(
    await worker.fetch("/v1/account/members", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: "admin" }),
    }),
  );
  expect(invited).toMatchObject({
    email: inviteEmail,
    role: "admin",
    status: "invited",
  });

  const withInvite = await getJson<AccountResponse>(
    await worker.fetch("/v1/account", {
      headers: { cookie },
    }),
  );
  expect(withInvite.members.map((member) => member.email)).toContain(
    inviteEmail,
  );

  const owner = withInvite.members.find((member) => member.role === "owner");
  expect(owner).toBeTruthy();
  const removeOwner = await worker.fetch(`/v1/account/members/${owner?.id}`, {
    method: "DELETE",
    headers: { cookie },
  });
  expect(removeOwner.status).toBe(403);

  const afterRemove = await getJson<AccountResponse>(
    await worker.fetch(`/v1/account/members/${invited.id}`, {
      method: "DELETE",
      headers: { cookie },
    }),
  );
  expect(afterRemove.members.map((member) => member.id)).not.toContain(
    invited.id,
  );

  const firstAccountMemory = await getJson<MemoryResponse>(
    await worker.fetch("/v1/memories", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        content: "Account deletion must purge session-backed graph data.",
        tags: ["privacy"],
      }),
    }),
  );
  const secondAccountMemory = await getJson<MemoryResponse>(
    await worker.fetch("/v1/memories", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        content: "Account deletion should remove related graph edges too.",
        tags: ["privacy"],
      }),
    }),
  );
  await expectOk(
    await worker.fetch("/v1/graph/edges", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        sourceId: firstAccountMemory.id,
        targetId: secondAccountMemory.id,
        relationship: "supports",
      }),
    }),
  );
  const accountExport = await getJson<GraphExportResponse>(
    await worker.fetch("/v1/exports", {
      method: "POST",
      headers: { cookie },
    }),
  );
  expect(accountExport.key).toContain(`${account.workspace.tenantId}/exports/`);

  const mismatchedDeletion = await worker.fetch("/v1/account", {
    method: "DELETE",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      confirmEmail: "wrong@example.com",
      confirmTenantId: account.workspace.tenantId,
    }),
  });
  expect(mismatchedDeletion.status).toBe(409);
  expect(await mismatchedDeletion.json()).toMatchObject({
    error: "account_confirmation_mismatch",
  });

  const accountDeletion = await getJson<AccountDeletionResponse>(
    await worker.fetch("/v1/account", {
      method: "DELETE",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        confirmEmail: email,
        confirmTenantId: account.workspace.tenantId,
      }),
    }),
  );
  expect(accountDeletion).toMatchObject({
    email,
    tenantId: account.workspace.tenantId,
    controlPlane: {
      userDeleted: true,
      sessionsDeleted: 1,
      ownedWorkspacesDeleted: 1,
    },
    graph: {
      memoriesDeleted: 2,
      vectorIndex: {
        attempted: 2,
      },
      exports: {
        prefix: `${account.workspace.tenantId}/exports/`,
        attempted: 1,
        deleted: 1,
        failed: 0,
      },
    },
  });
  expect(accountDeletion.graph.edgesDeleted).toBeGreaterThanOrEqual(1);

  const accountAfterDeletion = await worker.fetch("/v1/account", {
    headers: { cookie },
  });
  expect(accountAfterDeletion.status).toBe(401);
  const purgedAccountGraph = await getJson<MemoryResponse[]>(
    await worker.fetch("/v1/memories", {
      headers: tenantHeaders(account.workspace.tenantId),
    }),
  );
  expect(purgedAccountGraph).toEqual([]);
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

test("memory extraction worker enriches relationships into graph edges", async () => {
  const worker = await startWorker();
  workers.push(worker);

  const tenant = `tenant-extraction-${crypto.randomUUID()}`;
  const anchor = await createMemory(worker, tenant, {
    content: "RAG recall uses Vectorize semantic candidates.",
    tags: ["retrieval"],
  });
  const source = await createMemory(worker, tenant, {
    content:
      "Graph Indexing depends on RAG. Vectorize supports Graph Indexing.",
    tags: ["architecture"],
  });

  const enriched = await waitForExtractedMemory(worker, tenant, source.id);
  expect(enriched.entityIds).toEqual(
    expect.arrayContaining(["graph-indexing", "rag", "vectorize"]),
  );
  expect(enriched.metadata.extraction).toMatchObject({
    strategy: "deterministic-worker-v1",
  });

  const neighbors = await getJson<EdgeResponse[]>(
    await worker.fetch(`/v1/graph/${source.id}/neighbors`, {
      headers: tenantHeaders(tenant),
    }),
  );
  expect(neighbors).toContainEqual(
    expect.objectContaining({
      sourceId: source.id,
      targetId: anchor.id,
      relationship: "depends_on",
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

test("recall benchmark preserves ranking quality across MemoryBench-style fixtures", async () => {
  const worker = await startWorker();
  workers.push(worker);

  const tenant = `tenant-benchmark-${crypto.randomUUID()}`;
  const targetSpecs = [
    {
      key: "maya-review",
      query: "Maya TypeScript review preference",
      content: "Maya prefers concise TypeScript code reviews.",
      tags: ["people", "reviews"],
      type: "preference",
      importance: 0.9,
    },
    {
      key: "atlas-day",
      query: "Atlas launch moved day",
      content: "The Atlas launch decision was moved to Tuesday.",
      tags: ["projects", "launch"],
      type: "decision",
      importance: 0.85,
    },
    {
      key: "boris-retrieval",
      query: "Boris retrieval",
      content: "Boris maintains Graph Indexing for OpenMemory retrieval.",
      tags: ["architecture"],
      type: "fact",
      importance: 0.8,
    },
    {
      key: "nina-standup",
      query: "Nina standup agenda preference",
      content: "Nina prefers morning standups with written agendas.",
      tags: ["people", "meetings"],
      type: "preference",
      importance: 0.82,
    },
    {
      key: "hermes-export",
      query: "Hermes graph backup export target",
      content: "The Hermes ingestion workflow exports graph backups to R2.",
      tags: ["projects", "ingestion"],
      type: "decision",
      importance: 0.88,
    },
    {
      key: "chunk-metadata",
      query: "source chunk title index metadata",
      content:
        "OpenMemory source chunks preserve title and chunk index metadata.",
      tags: ["docs", "sources"],
      type: "insight",
      importance: 0.78,
    },
    {
      key: "ada-timezone",
      query: "Ada timezone planning",
      content: "Ada plans retrospectives in Mountain time after lunch.",
      tags: ["people", "calendar"],
      type: "preference",
      importance: 0.77,
    },
    {
      key: "phoenix-owner",
      query: "Phoenix search owner",
      content: "Phoenix search relevance is owned by Priya.",
      tags: ["projects", "search"],
      type: "fact",
      importance: 0.86,
    },
    {
      key: "security-review",
      query: "security review requirement before launch",
      content: "Security review must pass before the public launch checklist.",
      tags: ["launch", "security"],
      type: "decision",
      importance: 0.9,
    },
    {
      key: "mcp-scope",
      query: "MCP client write scope",
      content: "MCP clients need memory:write scope to store new facts.",
      tags: ["mcp", "oauth"],
      type: "fact",
      importance: 0.83,
    },
    {
      key: "dashboard-theme",
      query: "dashboard shadcn theme baseline",
      content: "The hosted dashboard should keep shadcn defaults as baseline.",
      tags: ["ui", "shadcn"],
      type: "preference",
      importance: 0.74,
    },
    {
      key: "queue-dlq",
      query: "failed source ingestion queue destination",
      content:
        "Failed source ingestion jobs retry before landing in the dead-letter queue.",
      tags: ["queues", "operations"],
      type: "insight",
      importance: 0.79,
    },
  ] as const;
  const targets = new Map<string, MemoryResponse>();
  for (const spec of targetSpecs) {
    targets.set(
      spec.key,
      await createMemory(worker, tenant, {
        content: spec.content,
        tags: [...spec.tags],
        type: spec.type,
        importance: spec.importance,
      }),
    );
  }

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

  for (const content of [
    "The coffee machine requires descaling every Friday.",
    "Atlas coffee chat moved to Thursday.",
    "Hermes courier schedule is unrelated to graph exports.",
    "Maya likes long-form prose in book club notes.",
    "Phoenix office search badges are printed near reception.",
    "OAuth client lunches do not require memory scopes.",
    "The dashboard theme party uses confetti outside the app.",
    "Queue trivia night starts after operations office hours.",
  ]) {
    await createMemory(worker, tenant, {
      content,
      tags: ["distractor"],
    });
  }

  const cases = targetSpecs.map((spec) => ({
    key: spec.key,
    query: spec.query,
    targetId: targets.get(spec.key)?.id ?? "",
  }));

  const reciprocalRanks = await Promise.all(
    cases.map(async (benchmarkCase) => {
      const results = await search(worker, tenant, {
        q: benchmarkCase.query,
        limit: 5,
      });
      return reciprocalRank(results, benchmarkCase.targetId);
    }),
  );
  const hitAt3 = await Promise.all(
    cases.map(async (benchmarkCase) => {
      const results = await search(worker, tenant, {
        q: benchmarkCase.query,
        limit: 3,
      });
      return results.some((result) => result.id === benchmarkCase.targetId)
        ? 1
        : 0;
    }),
  );
  const meanReciprocalRank =
    reciprocalRanks.reduce((total, rank) => total + rank, 0) /
    reciprocalRanks.length;
  const hitAt3Rate =
    hitAt3.reduce<number>((total, hit) => total + hit, 0) / hitAt3.length;

  await appendBenchmarkReport({
    type: "recall-quality",
    tenant,
    cases: cases.length,
    meanReciprocalRank,
    meanReciprocalRankThreshold: 0.84,
    hitAt3Rate,
    hitAt3Threshold: 0.9,
  });

  expect(meanReciprocalRank).toBeGreaterThanOrEqual(0.84);
  expect(hitAt3Rate).toBeGreaterThanOrEqual(0.9);
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

test("graph stats and recall stay bounded on a larger local graph", async () => {
  const requestedGraphSize = Number(process.env.OPENMEMORY_SCALE_GRAPH_SIZE);
  const graphSize = Number.isFinite(requestedGraphSize)
    ? Math.max(220, Math.min(1_000, requestedGraphSize))
    : 220;
  const worker = await startWorker({
    OPENMEMORY_RATE_LIMIT_PER_MINUTE: String(graphSize + 50),
  });
  workers.push(worker);

  const tenant = `tenant-scale-${crypto.randomUUID()}`;
  const topics = ["Atlas", "Borealis", "Cosmos", "Delta"];
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
  expect(stats.relationshipDistribution.length).toBeGreaterThan(0);
  expect(stats.graphDensity).toBeGreaterThan(0);

  const startedAt = performance.now();
  const results = await search(worker, tenant, {
    q: "Atlas Graph Indexing retrieval notes",
    limit: 10,
  });
  const elapsedMs = performance.now() - startedAt;

  await appendBenchmarkReport({
    type: "graph-scale",
    tenant,
    graphSize,
    activeMemories: stats.activeMemories,
    totalEdges: stats.totalEdges,
    relationshipCount: stats.relationshipCount,
    graphDensity: stats.graphDensity,
    recallLimit: 10,
    recallResultCount: results.length,
    recallElapsedMs: Number(elapsedMs.toFixed(2)),
    recallElapsedThresholdMs: 7_500,
  });

  expect(results).toHaveLength(10);
  expect(results[0]?.content).toContain("Atlas");
  expect(elapsedMs).toBeLessThan(7_500);
}, 180_000);

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
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await startWorkerOnce(env);
    } catch (error) {
      lastError = error;
      if (!isWranglerAddressInUse(error) || attempt === 3) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function startWorkerOnce(env: Record<string, string>) {
  const port = await getAvailablePort();
  const inspectorPort = await getAvailablePort();
  await mkdir(testTmpRoot, { recursive: true });
  const persistTo = await mkdtemp(join(testTmpRoot, "wrangler-state-"));
  const output: string[] = [];
  await applyLocalMigrations(persistTo);

  const proc = spawn(
    wranglerBin,
    [
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
      cwd: apiRoot,
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
  try {
    await waitForHealth(baseUrl, proc, output);
  } catch (error) {
    proc.kill("SIGTERM");
    await Promise.race([waitForExit(proc), sleep(3_000)]);
    if (proc.exitCode === null) {
      proc.kill("SIGKILL");
      await waitForExit(proc);
    }
    await rm(persistTo, { force: true, recursive: true });
    throw error;
  }

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

function isWranglerAddressInUse(error: unknown) {
  return (
    error instanceof Error && error.message.includes("Address already in use")
  );
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

async function waitForExtractedMemory(
  worker: WorkerProcess,
  tenantId: string,
  memoryId: string,
) {
  const startedAt = Date.now();
  let latest: MemoryResponse | undefined;

  while (Date.now() - startedAt < 20_000) {
    latest = await getJson<MemoryResponse>(
      await worker.fetch(`/v1/memories/${memoryId}`, {
        headers: tenantHeaders(tenantId),
      }),
    );
    const extraction = latest.metadata.extraction as
      | Record<string, unknown>
      | undefined;
    if (
      typeof extraction === "object" &&
      extraction !== null &&
      "relationships" in extraction &&
      extraction.strategy === "deterministic-worker-v1"
    ) {
      return latest;
    }
    await sleep(500);
  }

  throw new Error(
    `Timed out waiting for memory extraction: ${JSON.stringify(latest)}`,
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
    wranglerBin,
    [
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
      cwd: apiRoot,
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
  source: string;
  conversationId?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  type: string;
  status: string;
  isLatest: boolean;
  confidence: number;
  importance: number;
  validFrom?: string;
  validUntil?: string;
  entityIds: string[];
  supersedesId?: string;
  forgottenAt?: string;
  forgetReason?: string;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
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

type AccountResponse = {
  user: {
    id: string;
    email: string;
    name: string;
  };
  workspace: {
    id: string;
    name: string;
    tenantId: string;
  };
  members: WorkspaceMemberResponse[];
};

type AccountDeletionResponse = {
  userId: string;
  email: string;
  tenantId: string;
  controlPlane: {
    oauthAccessTokensDeleted: number;
    oauthRefreshTokensDeleted: number;
    oauthConsentsDeleted: number;
    oauthClientsDeleted: number;
    sessionsDeleted: number;
    authAccountsDeleted: number;
    ownedWorkspacesDeleted: number;
    workspaceMembershipsDeleted: number;
    userDeleted: boolean;
  };
  graph: {
    memoriesDeleted: number;
    edgesDeleted: number;
    tagsDeleted: number;
    entitiesDeleted: number;
    ingestionJobsDeleted: number;
    vectorIndex: {
      attempted: number;
      deleted: number;
      vectorizeConfigured: boolean;
    };
    exports: TenantExportCleanupResponse;
    purgedAt: string;
  };
  deletedAt: string;
};

type WorkspaceMemberResponse = {
  id: string;
  email: string;
  role: "owner" | "admin" | "member";
  status: "active" | "invited";
  userId?: string;
};

type SessionResponse = {
  user: {
    id: string;
    email: string;
  };
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
  bindings: {
    authDb: boolean;
    durableObjects: boolean;
    vectorize: boolean;
    workersAi: boolean;
    r2Exports: boolean;
  };
  auth: {
    mode: "session" | "local-development-header";
  };
  mcp: {
    endpoint: string;
    authorizationServer: string;
    protectedResource: string;
    tools: string[];
  };
  rateLimit: {
    enabled: boolean;
    limitPerMinute: number;
  };
  semanticIndex: SemanticIndexResponse;
  rerank: {
    configured: boolean;
    workersAiConfigured: boolean;
    model?: string;
    timeoutMs: number;
    status: "enabled" | "disabled" | "misconfigured";
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

type TenantPurgeResponse = {
  tenantId: string;
  memoriesDeleted: number;
  edgesDeleted: number;
  tagsDeleted: number;
  entitiesDeleted: number;
  ingestionJobsDeleted: number;
  vectorIndex: {
    attempted: number;
    deleted: number;
    vectorizeConfigured: boolean;
  };
  exports: TenantExportCleanupResponse;
  purgedAt: string;
};

type GraphStatsResponse = {
  totalMemories: number;
  activeMemories: number;
  historicalMemories: number;
  forgottenMemories: number;
  totalEdges: number;
  relationshipCount: number;
  relationshipDistribution: Array<{
    relationship: string;
    label: string;
    category: string;
    count: number;
    averageWeight: number;
  }>;
  graphDensity: number;
  entityCount: number;
  tagCount: number;
  generatedAt: string;
};

type GraphRelationshipResponse = {
  relationship: string;
  category: string;
  direction: string;
  label: string;
  defaultWeight: number;
  description: string;
};

type GraphExportResponse = {
  key: string;
  bytes: number;
  memoryCount: number;
  edgeCount: number;
  writtenToR2: boolean;
};

type GraphImportResponse = {
  tenantId: string;
  mode: "replace" | "merge";
  version: 1;
  memoriesImported: number;
  memoriesSkipped?: number;
  memoriesOverwritten?: number;
  edgesImported: number;
  activeMemoriesIndexed: number;
  merged?: {
    memoriesSkipped: number;
    memoriesOverwritten: number;
  };
  replaced?: {
    memoriesDeleted: number;
    edgesDeleted: number;
    tagsDeleted: number;
    entitiesDeleted: number;
    ingestionJobsDeleted: number;
    vectorIndex: {
      attempted: number;
      deleted: number;
      vectorizeConfigured: boolean;
    };
    purgedAt: string;
  };
  importedAt: string;
};

type GraphImportPreviewResponse = {
  tenantId: string;
  mode: "replace" | "merge";
  conflictPolicy: "skip" | "overwrite";
  version: 1;
  previewedAt: string;
  incoming: {
    memories: number;
    edges: number;
  };
  existing: {
    memories: number;
    edges: number;
    tags: number;
    entities: number;
    ingestionJobs: number;
  };
  impact: {
    memoriesImported: number;
    memoriesSkipped: number;
    memoriesOverwritten?: number;
    edgesImported: number;
    wouldDelete: {
      memories: number;
      edges: number;
      tags: number;
      entities: number;
      ingestionJobs: number;
    };
    wouldReplace: boolean;
  };
  conflicts: {
    duplicateMemoryIds: string[];
    duplicateMemoryIdsTruncated: boolean;
    changedMemoryIds: string[];
    changedMemoryIdsTruncated: boolean;
    unchangedMemoryIds: string[];
    unchangedMemoryIdsTruncated: boolean;
    fieldConflicts: Array<{
      id: string;
      fields: string[];
    }>;
    fieldConflictsTruncated: boolean;
  };
  candidates: {
    newMemoryIds: string[];
    newMemoryIdsTruncated: boolean;
  };
};

type IndexRepairResponse = {
  attempted: number;
  expectedVectors: number;
  purgeableMemories: number;
  semanticIndex: SemanticIndexResponse;
  staleVectors: {
    attempted: number;
    deleted: number;
    vectorizeConfigured: boolean;
  };
  tenantId: string;
  vectorizeConfigured: boolean;
};

type SemanticIndexResponse = {
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

type TenantExportCleanupResponse = {
  r2Configured: boolean;
  prefix: string;
  attempted: number;
  deleted: number;
  failed: number;
  error?: string;
};
