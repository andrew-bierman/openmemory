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

function tenantHeaders(tenantId: string) {
  return { "x-openmemory-user-id": tenantId };
}

async function getJson<T>(response: Response) {
  await expectOk(response.clone());
  return (await response.json()) as T;
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
  supersedesId?: string;
};

type SearchResponse = MemoryResponse & {
  reason: "semantic" | "keyword";
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
  result: unknown;
};

type OAuthMetadataResponse = {
  authorization_endpoint: string;
  registration_endpoint: string;
  scopes_supported: string[];
};

type OAuthClientResponse = {
  client_id: string;
  token_endpoint_auth_method: string;
};

type SessionResponse = {
  user: {
    id: string;
    email: string;
  };
};
