import type { ExecutionContext } from "@cloudflare/workers-types";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { Env } from "../src/env";
import { createOpenMemoryMcpHandler } from "../src/mcp";

// Exercise authentication with real signatures; transport and D1 are local doubles.
vi.mock("agents/mcp", () => ({
  createMcpHandler: () => async () => new Response("accepted"),
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
    AUTH_DB: {
      prepare(sql: string) {
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
  const request = async (bearer: string) =>
    createOpenMemoryMcpHandler()(
      new Request(`${origin}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
          "x-openmemory-user-id": "victim",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
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
