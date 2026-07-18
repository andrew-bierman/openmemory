import { type APIResponse, expect, type Page, test } from "@playwright/test";

test.skip(
  process.env.OPENMEMORY_LIVE_E2E !== "true",
  "Set OPENMEMORY_LIVE_E2E=true to run live browser E2E.",
);

test("hosted UI signs up, stores memory, and recalls context", async ({
  page,
}) => {
  const email = `ui-e2e-${crypto.randomUUID()}@example.com`;
  const inviteEmail = `ui-invite-${crypto.randomUUID()}@example.com`;
  const password = "password1234";
  const memory = `UI E2E stores Graph Indexing context ${crypto.randomUUID()}`;
  const displayName = `UI Admin ${crypto.randomUUID().slice(0, 8)}`;
  const workspaceName = `UI Workspace ${crypto.randomUUID().slice(0, 8)}`;

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "OpenMemory" })).toBeVisible();
  await page.locator("#name").fill("UI E2E");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/(\?view=recall)?$/);
  await expect(
    page.getByRole("heading", { name: "Memory Dashboard" }),
  ).toBeVisible();
  await expect(page.getByText(email).first()).toBeVisible();
  await expect(page.getByLabel("API URL")).toHaveValue(/workers\.dev|https?:/);

  await page.locator("#content").fill(memory);
  await page.locator("#tags").fill("ui-e2e");
  await page.getByRole("button", { name: "Remember" }).click();
  await expect(page.locator("tbody")).toContainText(memory);

  await page.getByRole("button", { name: /Refresh/ }).click();
  await expect(page.locator("tbody")).toContainText(memory);

  await page.getByLabel("Recall query").fill("Graph Indexing UI E2E");
  await page
    .locator(".toolbar")
    .getByRole("button", { name: "Recall", exact: true })
    .click();
  await expect(page.locator("pre.context").first()).toContainText(
    "Graph Indexing",
  );

  const [deleteResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/v1/memories/") &&
        response.request().method() === "DELETE",
    ),
    page.getByRole("button", { name: "Forget" }).first().click(),
  ]);
  expect(deleteResponse.ok()).toBe(true);
  await expect(page.getByText(memory)).toHaveCount(0, { timeout: 15_000 });

  const readinessResponse = await page.request.get("/v1/readiness");
  expect(readinessResponse.ok()).toBe(true);
  const readiness = (await readinessResponse.json()) as {
    auth: { mode: string };
    mcp: { tools: string[] };
    tenant: { source: string };
  };
  expect(readiness.auth.mode).toBe("session");
  expect(readiness.tenant.source).toBe("session");
  expect(readiness.mcp.tools).toEqual([
    "remember",
    "recall",
    "profile",
    "forget",
  ]);

  const accountResponse = await page.request.get("/v1/account");
  expect(accountResponse.ok()).toBe(true);
  const account = (await accountResponse.json()) as {
    user: { email: string; name: string };
    workspace: { tenantId: string };
  };

  await page
    .locator(".tabs")
    .getByRole("button", { name: "Admin", exact: true })
    .click();
  await expect(page).toHaveURL(/view=admin/);
  await expect(
    page.getByRole("heading", { name: "User profile" }),
  ).toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveValue(account.user.name);

  await page.getByLabel("Display name").fill(displayName);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(
    page.locator(".admin-card").filter({ hasText: "User profile" }),
  ).toContainText(displayName);

  await page.getByLabel("Workspace name").fill(workspaceName);
  await page.getByRole("button", { name: "Save workspace" }).click();
  await expect(
    page.locator(".admin-card").filter({ hasText: "Team and tenant" }),
  ).toContainText(workspaceName);

  await page.getByLabel("Member email").fill(inviteEmail);
  await page.getByLabel("Role").selectOption("admin");
  await page.getByRole("button", { name: "Invite member" }).click();
  const invitedMember = page.locator(".member-row").filter({
    hasText: inviteEmail,
  });
  await expect(invitedMember).toContainText("admin");
  await expect(invitedMember).toContainText("invited");
  await invitedMember.getByRole("button", { name: "Remove" }).click();
  await expect(invitedMember).toHaveCount(0);

  const oauthClientResponse = await page.request.post(
    "/api/auth/oauth2/register",
    {
      headers: {
        accept: "application/json",
        origin: new URL(page.url()).origin,
      },
      data: {
        client_name: "OpenMemory Live Full Smoke",
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "openid profile memory:read memory:write",
      },
    },
  );
  const oauthClientBody = await oauthClientResponse.text();
  expect(oauthClientResponse.ok(), oauthClientBody).toBe(true);
  const oauthClient = JSON.parse(oauthClientBody) as { client_id: string };
  await authorizeOAuthClient(page, oauthClient.client_id);
  await page.getByRole("button", { name: /Refresh/ }).click();
  const oauthCard = page.locator(".admin-card").filter({
    hasText: "MCP client access",
  });
  await expect(oauthCard).toContainText("OpenMemory Live Full Smoke");
  await expect(oauthCard).toContainText("memory:read");
  await oauthCard
    .locator("article", { hasText: oauthClient.client_id })
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(oauthCard).not.toContainText(oauthClient.client_id);

  await page.getByLabel("Confirm email").fill(account.user.email);
  await page.getByLabel("Confirm tenant id").fill(account.workspace.tenantId);
  const [accountDeletionResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/v1/account") &&
        response.request().method() === "DELETE",
    ),
    page.getByRole("button", { name: "Delete account" }).click(),
  ]);
  expect(accountDeletionResponse.ok()).toBe(true);
  await expect(page.getByText(/Deleted \d+ memories/)).toBeVisible({
    timeout: 15_000,
  });

  expect(errors).toEqual([]);
});

async function authorizeOAuthClient(page: Page, clientId: string) {
  const baseUrl = new URL(page.url()).origin;
  const scope = "openid profile memory:read memory:write";
  const verifier = `openmemory-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const authorization = await oauthRedirectUrl(
    await page.request.get(
      `/api/auth/oauth2/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: "http://127.0.0.1/callback",
        scope,
        state: "live-ui-e2e",
        prompt: "consent",
        code_challenge: await pkceChallenge(verifier),
        code_challenge_method: "S256",
      })}`,
      {
        headers: {
          accept: "application/json",
          origin: baseUrl,
        },
        maxRedirects: 0,
      },
    ),
    baseUrl,
  );
  const callback =
    authorization.pathname === "/consent"
      ? new URL(
          (
            (await expectOkJson(
              await page.request.post("/api/auth/oauth2/consent", {
                data: {
                  accept: true,
                  scope,
                  oauth_query: authorization.search.slice(1),
                },
                headers: {
                  accept: "application/json",
                  origin: baseUrl,
                },
              }),
            )) as { url: string }
          ).url,
          baseUrl,
        )
      : authorization;
  const code = callback.searchParams.get("code");
  expect(code).toBeTruthy();

  const tokenResponse = await page.request.post("/api/auth/oauth2/token", {
    form: {
      grant_type: "authorization_code",
      client_id: clientId,
      code: code ?? "",
      code_verifier: verifier,
      redirect_uri: "http://127.0.0.1/callback",
      resource: `${baseUrl}/mcp`,
    },
    headers: {
      accept: "application/json",
      origin: baseUrl,
    },
  });
  const token = (await expectOkJson(tokenResponse)) as {
    access_token: string;
    token_type: string;
  };
  expect(token.access_token).toBeTruthy();
  expect(token.token_type).toBe("Bearer");
}

async function oauthRedirectUrl(response: APIResponse, baseUrl: string) {
  const location = response.headers().location;
  if (location) {
    return new URL(location, baseUrl);
  }

  const body = (await expectOkJson(response)) as { url: string };
  return new URL(body.url, baseUrl);
}

async function expectOkJson(response: APIResponse) {
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
