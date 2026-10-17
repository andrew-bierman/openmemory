import { describe, expect, test, vi } from "vitest";
import type { Env } from "../src/env";
import {
  bindAuthorizationCode,
  createBoundRefreshToken,
  createGrantClaimsResolver,
  readTokenClientId,
} from "../src/oauth-grant";

function request(body: string, authorization?: string, json = false) {
  return new Request("https://openmemory.test/api/auth/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": json
        ? "application/json"
        : "application/x-www-form-urlencoded",
      ...(authorization ? { authorization } : {}),
    },
    body,
  });
}
function fixture() {
  const state = { id: "consent-A", grant_version: "version-A" };
  const bind = vi.fn((_userId: string, _clientId: string) => ({
    first: async () => ({ ...state }),
  }));
  const env = { AUTH_DB: { prepare: () => ({ bind }) } } as unknown as Env;
  return { state, bind, env };
}
const binding = { grantId: "consent-A", grantVersion: "version-A" };

describe("OAuth grant binding", () => {
  test("accepts public form/JSON and Basic client identities", async () => {
    expect(await readTokenClientId(request("client_id=client-A"))).toBe(
      "client-A",
    );
    expect(
      await readTokenClientId(
        request('{"client_id":"client-A"}', undefined, true),
      ),
    ).toBe("client-A");
    expect(
      await readTokenClientId(request("", `Basic ${btoa("client-A:secret")}`)),
    ).toBe("client-A");
    expect(
      await readTokenClientId(
        request("client_id=client-A", `Basic ${btoa("client-A:secret")}`),
      ),
    ).toBe("client-A");
  });
  test("rejects conflicting, duplicate, malformed client identities", async () => {
    expect(
      await readTokenClientId(
        request("client_id=client-B", `Basic ${btoa("client-A:secret")}`),
      ),
    ).toBeUndefined();
    expect(
      await readTokenClientId(request("client_id=A&client_id=B")),
    ).toBeUndefined();
    expect(
      await readTokenClientId(request("", "Basic invalid!")),
    ).toBeUndefined();
    expect(
      await readTokenClientId(request("", `Basic ${btoa("client-A:")}`)),
    ).toBeUndefined();
    expect(
      await readTokenClientId(request('{"client_id":42}', undefined, true)),
    ).toBeUndefined();
  });
  test("captures once, so revocation between issuance and signing cannot change JWT or refresh generation", async () => {
    const f = fixture();
    const source = request("client_id=client-A&grant_type=authorization_code");
    const resolver = createGrantClaimsResolver(f.env, source);
    await source.text();
    await resolver.prepare("user-A", "authorization_code", {
      openMemoryGrant: binding,
    });
    f.state.grant_version = "version-B";
    expect(await resolver.claims("user-A")).toEqual({
      tenantId: "user-A",
      ...binding,
    });
    expect(f.bind.mock.calls).toEqual([["user-A", "client-A"]]);
    const oldRefresh = await resolver.generateRefreshToken();
    const resumed = createGrantClaimsResolver(
      f.env,
      request(
        new URLSearchParams({
          client_id: "client-A",
          grant_type: "refresh_token",
          refresh_token: `om_rt_${oldRefresh}`,
        }).toString(),
      ),
    );
    await expect(resumed.prepare("user-A", "refresh_token")).rejects.toThrow();
  });
  test("a fresh refresh remains valid and gets rotated with the same generation", async () => {
    const f = fixture();
    const refresh = createBoundRefreshToken(binding);
    const resolver = createGrantClaimsResolver(
      f.env,
      request(
        new URLSearchParams({
          client_id: "client-A",
          grant_type: "refresh_token",
          refresh_token: `om_rt_${refresh}`,
        }).toString(),
      ),
    );
    await resolver.prepare("user-A", "refresh_token");
    const rotated = await resolver.generateRefreshToken();
    expect(rotated === refresh).toBe(false);
    expect(await resolver.claims("user-A")).toEqual({
      tenantId: "user-A",
      ...binding,
    });
  });
  test("pending authorization codes keep their original grant across reconsent", async () => {
    const f = fixture();
    const codeValue = await bindAuthorizationCode(
      f.env,
      JSON.stringify({
        type: "authorization_code",
        userId: "user-A",
        query: { client_id: "client-A" },
      }),
    );
    f.state.grant_version = "version-B";
    const resolver = createGrantClaimsResolver(
      f.env,
      request("client_id=client-A&grant_type=authorization_code"),
    );
    await expect(
      resolver.prepare("user-A", "authorization_code", JSON.parse(codeValue)),
    ).rejects.toThrow();
  });
  test("legacy unbound refresh and authorization codes fail closed", async () => {
    const f = fixture();
    await expect(
      createGrantClaimsResolver(
        f.env,
        request(
          "client_id=client-A&grant_type=refresh_token&refresh_token=om_rt_legacy",
        ),
      ).prepare("user-A", "refresh_token"),
    ).rejects.toThrow();
    await expect(
      createGrantClaimsResolver(
        f.env,
        request("client_id=client-A&grant_type=authorization_code"),
      ).prepare("user-A", "authorization_code", {}),
    ).rejects.toThrow();
  });
});
