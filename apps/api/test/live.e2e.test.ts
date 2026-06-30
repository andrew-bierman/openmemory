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
    expect(await dashboard.text()).toContain("OpenMemory");

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

    const remember = await mcpCall(token.access_token, {
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
    });
    expect(JSON.stringify(remember)).toContain("Stored");

    const recall = await mcpCall(token.access_token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "recall",
        arguments: { query: "Live E2E MCP" },
      },
    });
    expect(JSON.stringify(recall)).toContain("Live E2E");
  }, 60_000);
});

describe.skipIf(runLiveE2E)("live production e2e", () => {
  test("set OPENMEMORY_LIVE_E2E=true to run production smoke", () => {
    expect(runLiveE2E).toBe(false);
  });
});

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
