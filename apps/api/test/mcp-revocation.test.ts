import type { ExecutionContext } from "@cloudflare/workers-types";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { Env } from "../src/env";
import { createOpenMemoryMcpHandler } from "../src/mcp";
import { listWorkspaces } from "../src/workspace-access";
import { listSharedMemories, readSharedMemory } from "../src/workspace-sharing";

vi.mock("../src/workspace-access", () => ({
  listWorkspaces: vi.fn(async () => [
    {
      id: "workspace-A",
      name: "Team A",
      role: "member",
      memberId: "internal-member",
      ownerUserId: "private-owner",
      invitationToken: "secret",
    },
  ]),
}));

vi.mock("../src/workspace-sharing", () => ({
  listSharedMemories: vi.fn(async () => ({ items: [], nextCursor: null })),
  readSharedMemory: vi.fn(async () => ({ shareId: "share-A" })),
}));

// Exercise authentication with real signatures; transport and D1 are local doubles.
vi.mock("agents/mcp", () => ({
  createMcpHandler:
    (server: {
      _registeredTools: Record<
        string,
        { handler: (args: Record<string, unknown>) => Promise<unknown> }
      >;
    }) =>
    async (request: Request) => {
      const body = (await request.json()) as {
        method: string;
        params?: { name: string; arguments: Record<string, unknown> };
      };
      if (body.method === "tools/call" && body.params) {
        const tool = server._registeredTools[body.params.name];
        return Response.json(
          tool
            ? await tool.handler(body.params.arguments)
            : { error: "missing_tool" },
        );
      }
      return new Response("accepted");
    },
}));

const origin = "https://openmemory.test";
const subject = "user-A";
const clientId = "client-A";
const issuedAt = Math.floor(Date.now() / 1000) - 10;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let publicKey: string;

beforeAll(async () => {
  keys = await generateKeyPair("EdDSA");
  publicKey = JSON.stringify(await exportJWK(keys.publicKey));
});

async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    tenantId: subject,
    grantId: "grant-A",
    grantVersion: "version-A",
    azp: clientId,
    scope: "memory:read",
    ...overrides,
  })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
    .setSubject(subject)
    .setIssuer(`${origin}/api/auth`)
    .setAudience(`${origin}/mcp`)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 3600)
    .sign(keys.privateKey);
}

function fixture() {
  const state = {
    grantId: "grant-A",
    grantVersion: "version-A",
    userExists: true,
    clientExists: true,
    disabled: false,
    consentExists: true,
    consentUserId: subject,
    consentClientId: clientId,
    createdAt: issuedAt - 1,
    scopes: JSON.stringify(["memory:read", "memory:write"]),
  };
  const getGraph = vi.fn(() => ({}));
  const env = {
    BETTER_AUTH_URL: origin,
    OPENMEMORY_AUTH_ALLOWED_EMAILS: "member@example.test",
    AUTH_DB: {
      prepare(sql: string) {
        if (sql.includes("SELECT email, email_verified")) {
          return {
            bind: () => ({
              first: async () =>
                state.userExists
                  ? { email: "member@example.test", email_verified: 1 }
                  : null,
            }),
          };
        }
        if (sql.includes("from jwks")) {
          return {
            all: async () => ({
              results: [{ id: "test-key", public_key: publicKey }],
            }),
          };
        }
        return {
          bind(userId: string, requestedClient: string) {
            return {
              first: async () => {
                if (
                  !state.userExists ||
                  !state.clientExists ||
                  !state.consentExists ||
                  userId !== state.consentUserId ||
                  requestedClient !== state.consentClientId
                )
                  return null;
                return {
                  id: state.grantId,
                  grant_version: state.grantVersion,
                  disabled: Number(state.disabled),
                  scopes: state.scopes,
                  created_at: state.createdAt,
                };
              },
            };
          },
        };
      },
    },
    MEMORY_GRAPHS: { idFromName: (name: string) => name, get: getGraph },
  } as unknown as Env;
  const request = async (
    bearer: string | undefined,
    name?: string,
    url = origin,
  ) =>
    createOpenMemoryMcpHandler()(
      new Request(`${url}/mcp`, {
        method: "POST",
        headers: {
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          "content-type": "application/json",
          "x-openmemory-user-id": "victim",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: name ? "tools/call" : "tools/list",
          ...(name
            ? {
                params: {
                  name,
                  arguments: {
                    workspaceId: "workspace-A",
                    shareId: "share-A",
                    q: "term",
                  },
                },
              }
            : {}),
        }),
      }),
      env,
      {} as ExecutionContext,
    );
  return { state, request, getGraph, env };
}

describe("MCP live grant enforcement", () => {
  test("rejects an already issued signed token after connection revocation", async () => {
    const f = fixture();
    const bearer = await token();
    expect((await f.request(bearer)).status).toBe(200);
    expect(f.getGraph).toHaveBeenCalledWith("user-a");
    f.getGraph.mockClear();
    f.state.consentExists = false;
    expect((await f.request(bearer)).status).toBe(401);
    expect(f.getGraph).not.toHaveBeenCalled();
  });

  test.each([
    "disabled",
    "deleted-user",
    "deleted-client",
    "different-user",
    "different-client",
    "regranted",
    "scope-removed",
  ])("rejects %s grants", async (kind) => {
    const f = fixture();
    if (kind === "disabled") f.state.disabled = true;
    if (kind === "deleted-user") f.state.userExists = false;
    if (kind === "deleted-client") f.state.clientExists = false;
    if (kind === "different-user") f.state.consentUserId = "user-B";
    if (kind === "different-client") f.state.consentClientId = "client-B";
    if (kind === "regranted") f.state.createdAt = issuedAt + 1;
    if (kind === "scope-removed")
      f.state.scopes = JSON.stringify(["memory:write"]);
    expect((await f.request(await token())).status).toBe(401);
    expect(f.getGraph).not.toHaveBeenCalled();
  });

  test("old token stays revoked after same-second reconsent", async () => {
    const f = fixture();
    f.state.createdAt = issuedAt;
    const oldToken = await token();
    expect((await f.request(oldToken)).status).toBe(200);
    f.state.grantId = "grant-B";
    f.state.grantVersion = "version-B";
    expect((await f.request(oldToken)).status).toBe(401);
    expect(
      (
        await f.request(
          await token({ grantId: "grant-B", grantVersion: "version-B" }),
        )
      ).status,
    ).toBe(200);
  });

  test("scope reexpansion does not reactivate an old token", async () => {
    const f = fixture();
    const oldToken = await token();
    f.state.scopes = "memory:write";
    f.state.grantVersion = "version-B";
    expect((await f.request(oldToken)).status).toBe(401);
    f.state.scopes = "memory:read memory:write";
    f.state.grantVersion = "version-C";
    expect((await f.request(oldToken)).status).toBe(401);
  });

  test("legacy tokens without a grant binding fail closed", async () => {
    const f = fixture();
    expect(
      (
        await f.request(
          await token({ grantId: undefined, grantVersion: undefined }),
        )
      ).status,
    ).toBe(401);
  });

  test("accepts current consent stored as OAuth space-delimited scopes", async () => {
    const f = fixture();
    f.state.scopes = "memory:read memory:write";
    expect((await f.request(await token())).status).toBe(200);
  });

  test("fails closed when the signed token has no authorized client", async () => {
    const f = fixture();
    expect((await f.request(await token({ azp: undefined }))).status).toBe(401);
    expect(f.getGraph).not.toHaveBeenCalled();
  });

  test("rejects a tenant claim that differs from the subject", async () => {
    const f = fixture();
    expect((await f.request(await token({ tenantId: "victim" }))).status).toBe(
      401,
    );
    expect(f.getGraph).not.toHaveBeenCalled();
  });
});

test("shared tools reject personal-only OAuth on hosted and localhost requests", async () => {
  for (const url of [origin, "http://localhost:8787"]) {
    const f = fixture();
    const response = await f.request(await token(), "shared_list", url);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      required_scope: "memory:shared:read",
    });
    expect(f.getGraph).not.toHaveBeenCalled();
  }
});

test("shared callbacks use verified raw subject and fail closed without OAuth", async () => {
  for (const name of ["shared_list", "shared_read", "shared_search"]) {
    vi.mocked(listSharedMemories).mockClear();
    vi.mocked(readSharedMemory).mockClear();
    const f = fixture();
    f.state.scopes = JSON.stringify(["memory:read", "memory:shared:read"]);
    const denied = await f.request(undefined, name, "http://localhost:8787");
    expect(await denied.json()).toMatchObject({ isError: true });
    expect(listSharedMemories).not.toHaveBeenCalled();
    expect(readSharedMemory).not.toHaveBeenCalled();
    const allowed = await f.request(
      await token({ scope: "memory:read memory:shared:read" }),
      name,
      "http://localhost:8787",
    );
    expect(allowed.headers.get("cache-control")).toBe("private, no-store");
    expect(await allowed.json()).toMatchObject({ content: [{ type: "text" }] });
    const service =
      name === "shared_read" ? readSharedMemory : listSharedMemories;
    expect(vi.mocked(service).mock.calls[0]?.slice(0, 3)).toEqual([
      f.env,
      subject,
      "workspace-A",
    ]);
  }
});
test("shared service failures do not expose internal errors", async () => {
  const f = fixture();
  f.state.scopes = JSON.stringify(["memory:read", "memory:shared:read"]);
  vi.mocked(readSharedMemory).mockRejectedValueOnce(
    new Error("secret database content"),
  );
  const response = await f.request(
    await token({ scope: "memory:read memory:shared:read" }),
    "shared_read",
  );
  expect(await response.json()).toEqual({
    isError: true,
    content: [{ type: "text", text: "Shared memory unavailable." }],
  });
});

test("local API key preserves personal access but grants no shared access", async () => {
  const f = fixture();
  f.env.OPENMEMORY_API_TOKEN = "local-test-key";
  expect(
    (await f.request("local-test-key", undefined, "http://localhost:8787"))
      .status,
  ).toBe(200);
  const response = await f.request(
    "local-test-key",
    "shared_read",
    "http://localhost:8787",
  );
  expect(await response.json()).toMatchObject({ isError: true });
});

test("shared-read scope alone does not replace base read scope", async () => {
  const f = fixture();
  f.state.scopes = JSON.stringify(["memory:shared:read"]);
  const response = await f.request(
    await token({ scope: "memory:shared:read" }),
    "shared_read",
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    required_scope: "memory:read",
  });
});

test("shared workspace discovery requires explicit scope and projects only public fields", async () => {
  const f = fixture();
  vi.mocked(listWorkspaces).mockClear();
  for (const url of [origin, "http://localhost:8787"]) {
    const denied = await f.request(await token(), "shared_workspaces", url);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      required_scope: "memory:shared:read",
    });
  }
  const local = await f.request(
    undefined,
    "shared_workspaces",
    "http://localhost:8787",
  );
  expect(await local.json()).toMatchObject({ isError: true });
  expect(listWorkspaces).not.toHaveBeenCalled();
  f.state.scopes = JSON.stringify(["memory:read", "memory:shared:read"]);
  const response = await f.request(
    await token({ scope: "memory:read memory:shared:read" }),
    "shared_workspaces",
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const result = (await response.json()) as { content: [{ text: string }] };
  expect(JSON.parse(result.content[0].text)).toEqual([
    { id: "workspace-A", name: "Team A", role: "member" },
  ]);
  expect(listWorkspaces).toHaveBeenCalledExactlyOnceWith(f.env, subject);
});
