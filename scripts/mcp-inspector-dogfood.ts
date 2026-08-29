import { spawn } from "node:child_process";

const baseUrl =
  process.env.OPENMEMORY_LIVE_BASE_URL ??
  "https://openmemory-api.abbierman101.workers.dev";
const origin = baseUrl;
const callbackUrl = "http://127.0.0.1:6276/oauth/callback";
const scope = "openid profile memory:read memory:write";

let cookie = "";
let cleanup: { confirmEmail: string; confirmTenantId: string } | undefined;
let oauthClientId = "";

try {
  const email = `mcp-inspector-${crypto.randomUUID()}@example.com`;
  const password = "password1234";

  const signUp = await fetchLive("/api/auth/sign-up/email", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      name: "MCP Inspector Dogfood",
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

  const oauthClient = await getJson<OAuthClientResponse>(
    fetchLive("/api/auth/oauth2/register", {
      method: "POST",
      headers: {
        cookie,
        ...jsonHeaders(),
      },
      body: JSON.stringify({
        client_name: "MCP Inspector Dogfood",
        redirect_uris: [callbackUrl],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope,
      }),
    }),
  );
  oauthClientId = oauthClient.client_id;

  const verifier = `openmemory-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const authorization = await redirectUrl(
    fetchLive(
      `/api/auth/oauth2/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: oauthClient.client_id,
        redirect_uri: callbackUrl,
        scope,
        state: "mcp-inspector-dogfood",
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
                  scope,
                  oauth_query: authorization.search.slice(1),
                }),
              }),
            )
          ).url,
        )
      : authorization;
  const code = callback.searchParams.get("code");
  if (!code) {
    throw new Error(`OAuth authorization callback did not include code.`);
  }

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
        code,
        code_verifier: verifier,
        redirect_uri: callbackUrl,
        resource: `${baseUrl}/mcp`,
      }),
    }),
  );
  if (!token.access_token || token.token_type !== "Bearer") {
    throw new Error("OAuth token exchange did not return a bearer token.");
  }

  const expectedTools = ["remember", "recall", "profile", "forget"];
  const expectedResources = ["openmemory://profile", "openmemory://recent"];
  const expectedPrompts = ["context"];

  const tools = await inspectorJson<ToolsListResponse>(
    "--method",
    "tools/list",
    "--strict",
  );
  assertIncludes(
    tools.tools.map((tool) => tool.name),
    expectedTools,
    "Inspector tools/list",
  );

  const remember = await inspectorJson<ToolCallResponse>(
    "--method",
    "tools/call",
    "--tool-name",
    "remember",
    "--tool-args-json",
    JSON.stringify({
      content: "MCP Inspector CLI verified OpenMemory hosted MCP.",
      tags: ["mcp", "inspector"],
      type: "fact",
    }),
  );
  const rememberedText = textContent(remember);
  const rememberedId = rememberedText.match(/Stored (mem_[^:]+):/)?.[1];
  if (!rememberedId) {
    throw new Error(`Inspector remember response did not include memory id.`);
  }

  const recall = await inspectorJson<ToolCallResponse>(
    "--method",
    "tools/call",
    "--tool-name",
    "recall",
    "--tool-args-json",
    JSON.stringify({ query: "Inspector CLI hosted MCP", limit: 5 }),
  );
  assertTextIncludes(textContent(recall), "Inspector CLI", "Inspector recall");

  const profile = await inspectorJson<ToolCallResponse>(
    "--method",
    "tools/call",
    "--tool-name",
    "profile",
    "--tool-args-json",
    "{}",
  );
  assertTextIncludes(
    textContent(profile),
    "Inspector CLI",
    "Inspector profile",
  );

  const resources = await inspectorJson<ResourcesListResponse>(
    "--method",
    "resources/list",
  );
  assertIncludes(
    resources.resources.map((resource) => resource.uri),
    expectedResources,
    "Inspector resources/list",
  );

  for (const uri of expectedResources) {
    const resource = await inspectorJson<ResourceReadResponse>(
      "--method",
      "resources/read",
      "--uri",
      uri,
    );
    assertTextIncludes(
      JSON.stringify(resource),
      "Inspector CLI",
      `Inspector resources/read ${uri}`,
    );
  }

  const prompts = await inspectorJson<PromptsListResponse>(
    "--method",
    "prompts/list",
  );
  assertIncludes(
    prompts.prompts.map((prompt) => prompt.name),
    expectedPrompts,
    "Inspector prompts/list",
  );

  const context = await inspectorJson<PromptGetResponse>(
    "--method",
    "prompts/get",
    "--prompt-name",
    "context",
    "--prompt-args",
    "query=Inspector CLI hosted MCP",
    "limit=5",
  );
  assertTextIncludes(
    JSON.stringify(context),
    "Inspector CLI",
    "Inspector prompts/get context",
  );

  const forget = await inspectorJson<ToolCallResponse>(
    "--method",
    "tools/call",
    "--tool-name",
    "forget",
    "--tool-args-json",
    JSON.stringify({
      id: rememberedId,
      reason: "mcp inspector dogfood cleanup",
    }),
  );
  assertTextIncludes(
    textContent(forget),
    `Forgot ${rememberedId}`,
    "Inspector forget",
  );

  console.log(
    JSON.stringify(
      {
        baseUrl,
        callbackUrl,
        mcpClientId: oauthClientId,
        serverUrl: `${baseUrl}/mcp`,
        transport: "streamable-http",
        checkedAt: new Date().toISOString(),
        inspectorPackage: "@modelcontextprotocol/inspector",
        exercised: {
          prompts: expectedPrompts,
          resources: expectedResources,
          tools: expectedTools,
        },
      },
      null,
      2,
    ),
  );

  async function inspectorJson<T>(...args: string[]): Promise<T> {
    const stdout = await run("bunx", [
      "@modelcontextprotocol/inspector",
      "--cli",
      "--transport",
      "http",
      "--server-url",
      `${baseUrl}/mcp`,
      "--header",
      `Authorization: Bearer ${token.access_token}`,
      "--format",
      "json",
      "--connect-timeout",
      "15000",
      ...args,
    ]);

    const parsed = JSON.parse(stdout) as { result?: T } | T;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "result" in parsed &&
      parsed.result !== undefined
    ) {
      return parsed.result;
    }

    return parsed as T;
  }
} finally {
  if (cookie && oauthClientId) {
    await authedJson(cookie, `/v1/oauth/connections/${oauthClientId}`, {
      method: "DELETE",
    }).catch((error) => {
      console.warn(
        `Failed to revoke MCP Inspector OAuth connection: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  if (cookie && cleanup) {
    await cleanupLiveAccount(cookie, cleanup, "MCP Inspector dogfood").catch(
      (error) => {
        console.warn(
          `Failed to clean up MCP Inspector account: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      },
    );
  }
}

async function run(command: string, args: string[]) {
  const proc = spawn(command, args, {
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  proc.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  proc.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  const code = await new Promise<number | null>((resolve) => {
    proc.on("close", resolve);
  });
  if (code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${code}:\n${stderr.join("")}`,
    );
  }

  return stdout.join("");
}

async function cleanupLiveAccount(
  cookieValue: string,
  account: { confirmEmail: string; confirmTenantId: string },
  label: string,
) {
  const response = await fetchLive("/v1/account", {
    method: "DELETE",
    headers: {
      cookie: cookieValue,
      origin,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(account),
  });
  if (!response.ok) {
    throw new Error(
      `${label} account cleanup failed with ${response.status}: ${await response.text()}`,
    );
  }
}

async function authedJson<T>(
  cookieValue: string,
  path: string,
  init: RequestInit = {},
) {
  return getJson<T>(
    fetchLive(path, {
      ...init,
      headers: {
        cookie: cookieValue,
        ...jsonHeaders(),
        ...init.headers,
      },
    }),
  );
}

function fetchLive(path: string, init?: RequestInit) {
  return fetch(new URL(path, baseUrl), init);
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
    .map((value) => value.split(";")[0])
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

function assertIncludes(values: string[], expected: string[], label: string) {
  for (const value of expected) {
    if (!values.includes(value)) {
      throw new Error(`${label} missing ${value}; got ${values.join(", ")}`);
    }
  }
}

function assertTextIncludes(value: string, expected: string, label: string) {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing ${expected}; got ${value}`);
  }
}

function textContent(response: ToolCallResponse) {
  return response.content
    .map((part) => (part.type === "text" ? part.text : JSON.stringify(part)))
    .join("\n");
}

type AccountResponse = {
  user: {
    email: string;
  };
  workspace: {
    tenantId: string;
  };
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

type ToolsListResponse = {
  tools: Array<{ name: string }>;
};

type ResourcesListResponse = {
  resources: Array<{ uri: string }>;
};

type PromptsListResponse = {
  prompts: Array<{ name: string }>;
};

type ToolCallResponse = {
  content: Array<
    | {
        text: string;
        type: "text";
      }
    | Record<string, unknown>
  >;
};

type ResourceReadResponse = Record<string, unknown>;

type PromptGetResponse = Record<string, unknown>;
