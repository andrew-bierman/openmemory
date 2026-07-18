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
  await expect(
    page.getByRole("heading", { name: "Memory Dashboard" }),
  ).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
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
  await expect(page.locator("tbody")).not.toContainText(memory);

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
