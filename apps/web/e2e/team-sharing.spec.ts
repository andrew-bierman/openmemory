import { type BrowserContext, expect, type Page, test } from "@playwright/test";

const API = "http://127.0.0.1:54150";
const headers = { origin: API };

test("accepted teammates see only explicitly shared versions and lose revoked access", async ({
  browser,
}) => {
  const contexts: BrowserContext[] = [];
  const accounts: {
    context: BrowserContext;
    email: string;
    tenantId: string;
  }[] = [];
  const createActor = async (name: string) => {
    const context = await browser.newContext();
    contexts.push(context);
    const email = `team-${name}-${crypto.randomUUID()}@example.com`;
    const signup = await context.request.post(`${API}/api/auth/sign-up/email`, {
      headers,
      data: { name, email, password: "Team-test-password-123" },
    });
    expect(signup.ok(), await signup.text()).toBe(true);
    const accountResponse = await context.request.get(`${API}/v1/account`, {
      headers,
    });
    expect(accountResponse.ok(), await accountResponse.text()).toBe(true);
    const account = await accountResponse.json();
    accounts.push({ context, email, tenantId: account.workspace.tenantId });
    const page = await context.newPage();
    await page.addInitScript(
      (api) => localStorage.setItem("openmemory:apiUrl", api),
      API,
    );
    return { context, page, email };
  };
  const openTeams = async (page: Page) => {
    await page.goto("/?view=admin");
    await expect(page.getByLabel("Team sharing")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Share selected version read-only" }),
    ).toBeVisible();
  };
  try {
    const owner = await createActor("Owner");
    const member = await createActor("Member");
    const outsider = await createActor("Outsider");
    const sharedText = `Team visible ${crypto.randomUUID()}`;
    const privateText = `Unshared secret ${crypto.randomUUID()}`;
    let memoryId = "";
    for (const content of [sharedText, privateText]) {
      const response = await owner.context.request.post(`${API}/v1/memories`, {
        headers,
        data: { content, type: "fact", tags: ["team-e2e"] },
      });
      expect(response.ok(), await response.text()).toBe(true);
      if (content === sharedText) memoryId = (await response.json()).id;
    }
    await openTeams(owner.page);
    const workspaceId = await owner.page
      .getByLabel("Team", { exact: true })
      .inputValue();
    await owner.page
      .getByLabel("Member email", { exact: true })
      .fill(member.email);
    await owner.page.getByRole("button", { name: "Create invitation" }).click();
    const secret = owner.page.getByLabel("New invitation secret");
    await expect(secret).not.toHaveValue("");
    const invitationId = await owner.page
      .getByLabel("New invitation ID")
      .inputValue();
    const token = await secret.inputValue();
    await owner.page
      .getByLabel("Your active memory version")
      .selectOption(memoryId);
    await owner.page
      .getByRole("button", { name: "Share selected version read-only" })
      .click();
    await expect(owner.page.getByLabel("Shared memory results")).toContainText(
      sharedText,
    );
    const pending = await member.context.request.get(
      `${API}/v1/workspaces/${workspaceId}/shares`,
      { headers },
    );
    expect(pending.status()).toBe(404);
    await openTeams(member.page);
    await member.page
      .getByLabel("Invitation ID", { exact: true })
      .fill(invitationId);
    await member.page
      .getByLabel("Invitation secret", { exact: true })
      .fill(token);
    await member.page
      .getByRole("button", { name: "Accept invitation" })
      .click();
    await expect(
      member.page.getByLabel("Invitation ID", { exact: true }),
    ).toHaveValue("");
    await member.page
      .getByLabel("Team", { exact: true })
      .selectOption(workspaceId);
    const results = member.page.getByLabel("Shared memory results");
    await expect(results).toContainText(sharedText);
    await expect(results).not.toContainText(privateText);
    await expect(
      results.getByRole("button", { name: "Revoke share" }),
    ).toHaveCount(0);
    await member.page.getByLabel("Search shared memories").fill("Team visible");
    await member.page
      .getByRole("button", { name: "Search shared", exact: true })
      .click();
    await expect(results).toContainText(sharedText);
    await member.page.screenshot({
      fullPage: true,
      path: test.info().outputPath("team-desktop.png"),
    });
    await member.page.setViewportSize({ width: 390, height: 844 });
    await expect(results).toContainText(sharedText);
    expect(
      await member.page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await member.page.screenshot({
      fullPage: true,
      path: test.info().outputPath("team-mobile.png"),
    });
    await member.page.setViewportSize({ width: 1280, height: 720 });
    const denied = await outsider.context.request.get(
      `${API}/v1/workspaces/${workspaceId}/shares`,
      { headers },
    );
    expect(denied.status()).toBe(404);
    await owner.page
      .getByRole("button", { name: "Revoke share", exact: true })
      .click();
    await expect(
      owner.page.getByLabel("Shared memory results"),
    ).not.toContainText(sharedText);
    await member.page
      .getByRole("button", { name: "Refresh shared memories" })
      .click();
    await expect(results).not.toContainText(sharedText);
    await member.page
      .getByRole("button", { name: "Leave team", exact: true })
      .click();
    await expect(
      member.page
        .getByLabel("Team", { exact: true })
        .locator(`option[value="${workspaceId}"]`),
    ).toHaveCount(0);
    const privateMemories = await owner.context.request.get(
      `${API}/v1/memories`,
      { headers },
    );
    expect(await privateMemories.text()).toContain(privateText);
  } finally {
    for (const { context, email, tenantId } of accounts) {
      const response = await context.request.delete(`${API}/v1/account`, {
        headers,
        data: { confirmEmail: email, confirmTenantId: tenantId },
      });
      expect(response.ok(), await response.text()).toBe(true);
    }
    await Promise.all(contexts.map((context) => context.close()));
  }
});
