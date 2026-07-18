import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page } from "@playwright/test";

const MCP_SCOPE = "openid profile memory:read memory:write";

export type McpOAuthCallbackResult = {
  clientId: string;
  callbackUrl: string;
};

export async function verifyMcpOAuthCallbackFlow(
  page: Page,
  options: {
    baseUrl: string;
    clientName: string;
    localTenantId?: string;
    statePrefix: string;
    memoryText: string;
  },
): Promise<McpOAuthCallbackResult> {
  const callback = await startCallbackServer();
  try {
    const origin = new URL(options.baseUrl).origin;
    const client = await registerOAuthClient(page, {
      baseUrl: options.baseUrl,
      callbackUrl: callback.url,
      clientName: options.clientName,
      origin,
    });
    const verifier = `openmemory-${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const state = `${options.statePrefix}-${crypto.randomUUID()}`;
    const authorizeUrl = `${options.baseUrl}/api/auth/oauth2/authorize?${new URLSearchParams(
      {
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: callback.url,
        scope: MCP_SCOPE,
        state,
        prompt: "consent",
        code_challenge: await pkceChallenge(verifier),
        code_challenge_method: "S256",
      },
    )}`;

    const callbackRequest = callback.nextRequest();
    await page.goto(authorizeUrl);
    await expect(
      page.getByRole("heading", { name: "Authorize client" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Allow" }).click();

    const callbackUrl = await callbackRequest;
    await expect(
      page.getByRole("heading", { name: "OpenMemory callback captured" }),
    ).toBeVisible();
    expect(callbackUrl.searchParams.get("state")).toBe(state);
    const code = callbackUrl.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenResponse = await page.request.post(
      `${options.baseUrl}/api/auth/oauth2/token`,
      {
        form: {
          grant_type: "authorization_code",
          client_id: client.client_id,
          code: code ?? "",
          code_verifier: verifier,
          redirect_uri: callback.url,
          resource: `${options.baseUrl}/mcp`,
        },
        headers: {
          accept: "application/json",
          origin,
        },
      },
    );
    const token = (await expectOkJson(tokenResponse)) as {
      access_token: string;
      token_type: string;
    };
    expect(token.access_token).toBeTruthy();
    expect(token.token_type).toBe("Bearer");

    await expectMcpBearerFlow(
      options.baseUrl,
      token.access_token,
      options.memoryText,
      options.localTenantId,
    );

    return {
      callbackUrl: callback.url,
      clientId: client.client_id,
    };
  } finally {
    await callback.close();
  }
}

async function registerOAuthClient(
  page: Page,
  options: {
    baseUrl: string;
    callbackUrl: string;
    clientName: string;
    origin: string;
  },
) {
  const response = await page.request.post(
    `${options.baseUrl}/api/auth/oauth2/register`,
    {
      data: {
        client_name: options.clientName,
        redirect_uris: [options.callbackUrl],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: MCP_SCOPE,
      },
      headers: {
        accept: "application/json",
        origin: options.origin,
      },
    },
  );
  return (await expectOkJson(response)) as { client_id: string };
}

async function expectMcpBearerFlow(
  baseUrl: string,
  accessToken: string,
  memoryText: string,
  localTenantId?: string,
) {
  const initialized = await mcpCall(
    baseUrl,
    accessToken,
    {
      jsonrpc: "2.0",
      id: "initialize",
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "openmemory-oauth-callback-verifier",
          version: "0.1.0",
        },
      },
    },
    localTenantId,
  );
  expect(JSON.stringify(initialized)).toContain("openmemory");

  await mcpCall(
    baseUrl,
    accessToken,
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    },
    localTenantId,
  );

  const tools = await mcpCall(
    baseUrl,
    accessToken,
    {
      jsonrpc: "2.0",
      id: "tools",
      method: "tools/list",
    },
    localTenantId,
  );
  expect(JSON.stringify(tools)).toContain("remember");
  expect(JSON.stringify(tools)).toContain("recall");

  const remember = await mcpCall(
    baseUrl,
    accessToken,
    {
      jsonrpc: "2.0",
      id: "remember",
      method: "tools/call",
      params: {
        name: "remember",
        arguments: {
          content: memoryText,
          tags: ["mcp", "oauth-callback"],
          type: "fact",
        },
      },
    },
    localTenantId,
  );
  expect(mcpText(remember)).toContain("Stored");

  const recall = await mcpCall(
    baseUrl,
    accessToken,
    {
      jsonrpc: "2.0",
      id: "recall",
      method: "tools/call",
      params: {
        name: "recall",
        arguments: {
          query: "OAuth callback verifier",
          limit: 5,
        },
      },
    },
    localTenantId,
  );
  expect(mcpText(recall)).toContain("OAuth callback verifier");
}

async function mcpCall(
  baseUrl: string,
  accessToken: string,
  body: Record<string, unknown>,
  localTenantId?: string,
) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(localTenantId ? { "x-openmemory-user-id": localTenantId } : {}),
    },
    body: JSON.stringify(body),
  });
  await expectOk(response.clone());
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : {};
}

function mcpText(response: unknown) {
  const result = (response as { result?: unknown }).result;
  const content = (result as { content?: Array<{ text?: string }> } | undefined)
    ?.content;
  return content?.map((item) => item.text ?? "").join("\n") ?? "";
}

async function startCallbackServer() {
  let resolveRequest: ((url: URL) => void) | undefined;
  let rejectRequest: ((error: Error) => void) | undefined;
  let requested = false;
  const requestPromise = new Promise<URL>((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });

  const server = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      requested = true;
      const host = request.headers.host ?? "127.0.0.1";
      const url = new URL(request.url ?? "/", `http://${host}`);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html><html lang="en"><head><title>OpenMemory callback captured</title></head><body><main><h1>OpenMemory callback captured</h1><p>You can return to the MCP client.</p></main></body></html>`,
      );
      resolveRequest?.(url);
    },
  );
  server.on("error", (error) => {
    rejectRequest?.(error instanceof Error ? error : new Error(String(error)));
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate OAuth callback port.");
  }
  const url = `http://127.0.0.1:${(address as AddressInfo).port}/callback`;

  return {
    url,
    nextRequest: () =>
      Promise.race([
        requestPromise,
        new Promise<URL>((_, reject) => {
          setTimeout(
            () =>
              reject(
                new Error(
                  requested
                    ? "OAuth callback did not resolve."
                    : "Timed out waiting for OAuth callback.",
                ),
              ),
            15_000,
          );
        }),
      ]),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function expectOk(response: Response) {
  if (!response.ok) {
    throw new Error(
      `Expected 2xx response, got ${response.status}: ${await response.text()}`,
    );
  }
}

async function expectOkJson(response: {
  ok: () => boolean;
  status: () => number;
  text: () => Promise<string>;
}) {
  const body = await response.text();
  expect(response.ok(), body).toBe(true);
  return JSON.parse(body) as unknown;
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
