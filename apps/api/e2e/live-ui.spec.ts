import { expect, test } from "@playwright/test";

test.skip(
  process.env.OPENMEMORY_LIVE_E2E !== "true",
  "Set OPENMEMORY_LIVE_E2E=true to run live browser E2E.",
);

test("hosted UI signs up, stores memory, and recalls context", async ({
  page,
}) => {
  const email = `ui-e2e-${crypto.randomUUID()}@example.com`;
  const password = "password1234";
  const memory = `UI E2E stores Graph Indexing context ${crypto.randomUUID()}`;

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

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#session")).toContainText(email);

  await page.locator("#content").fill(memory);
  await page.locator("#tags").fill("ui-e2e");
  await page.getByRole("button", { name: "Remember" }).click();
  await expect(page.locator("#memories")).toContainText(memory);

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.locator("#memories")).toContainText(memory);

  await page.locator("#query").fill("Graph Indexing UI E2E");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.locator("#context")).toContainText("Graph Indexing");

  const [deleteResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/v1/memories/") &&
        response.request().method() === "DELETE",
    ),
    page
      .locator("#memories")
      .getByRole("button", { name: "Forget" })
      .first()
      .click(),
  ]);
  expect(deleteResponse.ok()).toBe(true);
  await expect(page.locator("#memories")).not.toContainText(memory);

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

  expect(errors).toEqual([]);
});
