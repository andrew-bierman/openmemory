import { expect, test } from "@playwright/test";
import { verifyMcpOAuthCallbackFlow } from "./mcp-oauth-callback";

test.use({ trace: "off", screenshot: "off", video: "off" });

test.skip(
  process.env.OPENMEMORY_LIVE_E2E !== "true",
  "Set OPENMEMORY_LIVE_E2E=true to run live browser E2E.",
);

test("hosted UI uses an approved session, stores memory, and recalls context", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = approvedFixture("OPENMEMORY_LIVE_UI");
  const email = fixture.email;
  const inviteEmail = process.env.OPENMEMORY_LIVE_UI_INVITE_EMAIL;
  if (
    !inviteEmail ||
    inviteEmail === email ||
    process.env.OPENMEMORY_LIVE_UI_INVITE_APPROVAL !== inviteEmail
  ) {
    throw new Error(
      "Set OPENMEMORY_LIVE_UI_INVITE_EMAIL to a separately approved disposable identity",
    );
  }
  const verified = await page.request.get(`${fixture.origin}/v1/account`, {
    headers: { cookie: fixture.cookie, origin: fixture.origin },
    maxRedirects: 0,
  });
  if (!verified.ok())
    throw new Error("Disposable fixture session validation failed");
  assertFixtureAccount(await verified.json(), fixture);
  await page.context().addCookies(
    fixture.cookie.split(";").map((part) => {
      const index = part.indexOf("=");
      if (index < 1) throw new Error("Invalid session cookie header");
      return {
        name: part.slice(0, index).trim(),
        value: part.slice(index + 1).trim(),
        url: fixture.origin,
        secure: true,
        httpOnly: true,
        sameSite: "Lax" as const,
      };
    }),
  );
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

  await page.goto(`${fixture.origin}/`);
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

  await page
    .locator(".tabs")
    .getByRole("button", { name: "MCP", exact: true })
    .click();
  await expect(page).toHaveURL(/view=mcp/);
  await expect(page.getByLabel("Client name")).toBeEnabled();
  const managedClientName = `Live MCP Client ${crypto.randomUUID().slice(0, 8)}`;
  const managedRedirectUri = "http://127.0.0.1:39123/callback";
  await page.getByLabel("Client name").fill(managedClientName);
  await page.getByLabel("Redirect URIs").fill(managedRedirectUri);
  const [managedClientResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/v1/oauth/clients") &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Create client" }).click(),
  ]);
  expect(managedClientResponse.ok()).toBe(true);
  const managedClient = (await managedClientResponse.json()) as {
    clientId: string;
    name: string;
    redirectUris: string[];
    scopes: string[];
    disabled: boolean;
    requirePKCE: boolean;
    public: boolean;
  };
  expect(managedClient).toMatchObject({
    name: managedClientName,
    redirectUris: [managedRedirectUri],
    disabled: false,
    requirePKCE: true,
    public: true,
  });
  expect(managedClient.scopes).toEqual(
    expect.arrayContaining([
      "openid",
      "profile",
      "memory:read",
      "memory:write",
    ]),
  );
  const managedClientCard = page.locator("article", {
    hasText: managedClient.clientId,
  });
  await expect(managedClientCard).toContainText(managedClientName);
  await expect(managedClientCard).toContainText(managedRedirectUri);
  await expect(managedClientCard).toContainText("memory:write");

  const [managedClientDeleteResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(`/v1/oauth/clients/${managedClient.clientId}`) &&
        response.request().method() === "DELETE",
    ),
    managedClientCard.getByRole("button", { name: "Disable" }).click(),
  ]);
  expect(managedClientDeleteResponse.ok()).toBe(true);
  await expect(managedClientCard).toContainText("disabled");
  await expect(
    managedClientCard.getByRole("button", { name: "Disabled" }),
  ).toBeDisabled();

  const oauthClient = await verifyMcpOAuthCallbackFlow(page, {
    baseUrl: new URL(page.url()).origin,
    clientName: "OpenMemory Live Full Smoke",
    statePrefix: "live-ui-e2e",
    memoryText: `OAuth callback verifier stores MCP context ${crypto.randomUUID()}`,
  });
  await page.goto("/?view=admin");
  await expect(
    page.getByRole("heading", { name: "User profile" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Refresh/ }).click();
  const oauthCard = page.locator(".admin-card").filter({
    hasText: "MCP client access",
  });
  await expect(oauthCard).toContainText("OpenMemory Live Full Smoke");
  await expect(oauthCard).toContainText("memory:read");
  await oauthCard
    .locator("article", { hasText: oauthClient.clientId })
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(oauthCard).not.toContainText(oauthClient.clientId);

  assertFixtureAccount(account, fixture);
  const beforeDelete = await page.request.get(`${fixture.origin}/v1/account`);
  if (!beforeDelete.ok())
    throw new Error("Cannot revalidate account before cleanup");
  assertFixtureAccount(await beforeDelete.json(), fixture);
  await page.getByLabel("Confirm email").fill(fixture.email);
  await page.getByLabel("Confirm tenant id").fill(fixture.tenantId);
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

// Provision these disposable identities outside the runner after approval.
// Never infer deletion authority from the account returned by the server.
function approvedFixture(prefix: string) {
  const email = process.env[`${prefix}_EMAIL`];
  const tenantId = process.env[`${prefix}_TENANT_ID`];
  const cookie = process.env[`${prefix}_SESSION_COOKIE`];
  const target = process.env.OPENMEMORY_LIVE_BASE_URL;
  if (
    !email ||
    !tenantId ||
    !cookie ||
    !target ||
    process.env[`${prefix}_DISPOSABLE_APPROVAL`] !== `${email}:${tenantId}`
  ) {
    throw new Error(
      `Missing approved disposable fixture for ${prefix}; see docs/passwordless-live-qualification.md`,
    );
  }
  const url = new URL(target);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    /[\r\n]/.test(cookie)
  ) {
    throw new Error(
      "Live fixture requires an explicit HTTPS origin and valid session cookie",
    );
  }
  return { email, tenantId, cookie, origin: url.origin };
}

function assertFixtureAccount(
  account: { user: { email: string }; workspace: { tenantId: string } },
  fixture: ReturnType<typeof approvedFixture>,
) {
  if (
    account.user.email !== fixture.email ||
    account.workspace.tenantId !== fixture.tenantId
  ) {
    throw new Error(
      "Fixture identity mismatch; refusing mutations and cleanup",
    );
  }
}
