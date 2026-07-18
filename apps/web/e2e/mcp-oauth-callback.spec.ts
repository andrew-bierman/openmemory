import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { verifyMcpOAuthCallbackFlow } from "../../api/e2e/mcp-oauth-callback";

const API_URL = "http://127.0.0.1:54150";

test("local OAuth callback verifier exchanges MCP bearer token through browser redirect", async ({
  page,
}) => {
  const screenshotDir = ".tmp/screenshots/launch-readiness";
  const email = `ui-oauth-callback-${crypto.randomUUID()}@example.com`;
  const password = "password1234";
  await mkdir(screenshotDir, { recursive: true });

  await page.goto(`${API_URL}/login`);
  await expect(page.getByRole("heading", { name: "OpenMemory" })).toBeVisible();
  await page.locator("#name").fill("OAuth Callback E2E");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/(\?view=recall)?$/);

  const account = (await expectOkJson(
    await page.request.get(`${API_URL}/v1/account`, {
      headers: { accept: "application/json", origin: API_URL },
    }),
  )) as {
    user: { email: string };
    workspace: { tenantId: string };
  };

  try {
    const oauthClient = await verifyMcpOAuthCallbackFlow(page, {
      baseUrl: API_URL,
      clientName: "OpenMemory Local OAuth Callback E2E",
      localTenantId: account.workspace.tenantId,
      statePrefix: "local-ui-e2e",
      memoryText: `OAuth callback verifier stores MCP context ${crypto.randomUUID()}`,
    });
    expect(oauthClient.callbackUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
    );
    await page.screenshot({
      fullPage: true,
      path: `${screenshotDir}/10-oauth-callback-captured.png`,
    });
  } finally {
    const deleted = await page.request.delete(`${API_URL}/v1/account`, {
      data: {
        confirmEmail: account.user.email,
        confirmTenantId: account.workspace.tenantId,
      },
      headers: { accept: "application/json", origin: API_URL },
    });
    expect(deleted.ok(), await deleted.text()).toBe(true);
  }
});

async function expectOkJson(response: {
  ok: () => boolean;
  text: () => Promise<string>;
}) {
  const body = await response.text();
  expect(response.ok(), body).toBe(true);
  return JSON.parse(body) as unknown;
}
