import { expect, test } from "@playwright/test";
import { verifyMcpOAuthCallbackFlow } from "./mcp-oauth-callback";

test.skip(
  process.env.OPENMEMORY_LIVE_E2E !== "true",
  "Set OPENMEMORY_LIVE_E2E=true to run live browser E2E.",
);

test("hosted UI signs up, stores memory, and recalls context", async ({
  page,
}) => {
  test.setTimeout(120_000);
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
