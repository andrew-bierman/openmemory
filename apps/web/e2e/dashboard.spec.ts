import { expect, test } from "@playwright/test";

const API_URL = "http://127.0.0.1:54150";

test("local dashboard renders TanStack table, charts, and graph explorer", async ({
  page,
}) => {
  const tenant = `ui-e2e-${crypto.randomUUID()}`;
  const errors: string[] = [];

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("401") &&
      !message.text().includes("Unauthorized") &&
      !message.text().includes("Failed to load resource")
    ) {
      errors.push(message.text());
    }
  });
  page.on("response", (response) => {
    const status = response.status();
    if (response.url().startsWith(API_URL) && status >= 400 && status !== 401) {
      errors.push(`${status} ${response.url()}`);
    }
  });

  const seeded = await seedTenant(tenant);

  await page.goto("/");
  await page.evaluate(
    ({ apiUrl, tenantId }) => {
      window.localStorage.setItem("openmemory:apiUrl", apiUrl);
      window.localStorage.setItem("openmemory:tenantId", tenantId);
    },
    { apiUrl: API_URL, tenantId: tenant },
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /refresh/i }).click();

  await expect(
    page.getByRole("heading", { name: "Memory Dashboard" }),
  ).toBeVisible();
  await expect(page.locator(".recharts-wrapper")).toHaveCount(2);
  await expect(page.getByText("Total captures")).toBeVisible();
  await expect(page.getByText("Leading type")).toBeVisible();
  await expect(page.getByLabel("Memory type ranking")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(4);
  await expect(page.getByText("4 of 4 rows")).toBeVisible();

  await page.getByLabel("Recall query").fill("cloudflare graph");
  await page
    .locator(".toolbar")
    .getByRole("button", { name: "Recall", exact: true })
    .click();
  await expect(page).toHaveURL(/recallQuery=cloudflare(?:%20|\+)graph/);
  await expect(page.locator("pre.context").first()).toContainText(
    "OpenMemory uses Durable Objects",
  );
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("Recall query")).toHaveValue("cloudflare graph");
  await expect(page.locator("pre.context").first()).toContainText(
    "Recall combines graph traversal",
  );

  await page.goto("/?recallQuery=vectorize", { waitUntil: "networkidle" });
  await expect(page.getByLabel("Recall query")).toHaveValue("vectorize");
  await expect(page.locator("pre.context").first()).toContainText("Vectorize");

  await page.getByLabel("Search memory records").fill("graph");
  await expect(page).toHaveURL(/memorySearch=graph/);
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await expect(page.getByText("3 of 4 rows")).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("Search memory records")).toHaveValue("graph");
  await expect(page.locator("tbody tr")).toHaveCount(3);

  await page.getByLabel("Search memory records").fill("");
  await page.getByLabel("Filter memories by type").selectOption("decision");
  await expect(page).toHaveURL(/memoryType=decision/);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText("1 of 4 rows")).toBeVisible();
  await page.getByRole("button", { name: /Updated/ }).click();
  await expect(page).toHaveURL(/memorySort=updatedAt\.asc/);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("Filter memories by type")).toHaveValue(
    "decision",
  );
  await expect(page.getByRole("button", { name: /Updated/ })).toContainText(
    "↑",
  );

  await page.goto("/?memorySearch=graph&memoryType=insight", {
    waitUntil: "networkidle",
  });
  await expect(page.getByLabel("Search memory records")).toHaveValue("graph");
  await expect(page.getByLabel("Filter memories by type")).toHaveValue(
    "insight",
  );
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText("1 of 4 rows")).toBeVisible();
  await page.goto("/");
  await expect(page.locator("tbody tr")).toHaveCount(4);

  await page
    .locator(".tabs")
    .getByRole("button", { name: "Knowledge Map", exact: true })
    .click();
  await expect(page.locator(".graph-controls input")).toBeVisible();
  await expect(page.locator(".graph-controls select")).toBeVisible();
  await expect(page.locator(".force-graph-frame canvas")).toHaveCount(1);
  await expect(page.locator(".graph-node-card")).toHaveCount(4);

  await page.getByLabel("Filter graph memories").fill("cloudflare");
  await expect(page).toHaveURL(/graphSearch=cloudflare/);
  await expect(page.locator(".graph-node-card")).toHaveCount(2);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("Filter graph memories")).toHaveValue(
    "cloudflare",
  );
  await expect(page.locator(".graph-node-card")).toHaveCount(2);

  await page.getByLabel("Filter graph memories").fill("");
  await page.getByLabel("Filter graph by memory type").selectOption("insight");
  await expect(page).toHaveURL(/graphType=insight/);
  await expect(page.locator(".graph-node-card")).toHaveCount(1);
  await expect(page.locator(".graph-node-card").first()).toContainText(
    "insight",
  );
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("Filter graph by memory type")).toHaveValue(
    "insight",
  );
  await expect(page.locator(".graph-node-card")).toHaveCount(1);

  await page.getByRole("button", { name: "Fit graph" }).click();

  await page
    .locator(".tabs")
    .getByRole("button", { name: "Admin", exact: true })
    .click();
  await expect(page).toHaveURL(/view=admin/);
  const adminGrid = page.locator(".admin-grid");
  await expect(adminGrid).toBeVisible();
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(adminGrid.getByLabel("API URL")).toHaveValue(API_URL);
  await expect(adminGrid.getByLabel("Local tenant")).toHaveValue(tenant);
  await expect(
    page.getByText("Header tenant for local development"),
  ).toBeVisible();

  await page
    .locator(".tabs")
    .getByRole("button", { name: "MCP", exact: true })
    .click();
  await expect(page).toHaveURL(/view=mcp/);
  await expect(page.locator("pre.context").first()).toContainText(
    "/.well-known/oauth-authorization-server/api/auth",
  );

  await page.goto("/?view=admin");
  await expect(page.locator(".admin-grid")).toBeVisible();
  await expect(
    page.locator(".tabs").getByRole("button", { name: "Admin", exact: true }),
  ).toHaveAttribute("aria-selected", "true");

  await page.goto("/?view=graph");
  await expect(page.locator(".force-graph-frame canvas")).toHaveCount(1);
  await expect(
    page
      .locator(".tabs")
      .getByRole("button", { name: "Knowledge Map", exact: true }),
  ).toHaveAttribute("aria-selected", "true");

  await page.goto("/?view=graph&graphSearch=cloudflare&graphType=decision", {
    waitUntil: "networkidle",
  });
  await expect(page.getByLabel("Filter graph memories")).toHaveValue(
    "cloudflare",
  );
  await expect(page.getByLabel("Filter graph by memory type")).toHaveValue(
    "decision",
  );
  await expect(page.locator(".graph-node-card")).toHaveCount(1);

  await page.goto("/");
  await page.evaluate(
    ({ apiUrl, tenantId }) => {
      window.localStorage.setItem("openmemory:apiUrl", apiUrl);
      window.localStorage.setItem("openmemory:tenantId", tenantId);
    },
    { apiUrl: API_URL, tenantId: tenant },
  );
  await page.reload({ waitUntil: "networkidle" });
  await page
    .locator("tbody")
    .getByRole("button", { name: "Inspect", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/view=graph/);
  await expect(page).toHaveURL(/memoryId=/);
  await expect(
    page.getByRole("heading", { name: "Memory Detail" }),
  ).toBeVisible();

  await page.evaluate(
    ({ apiUrl, tenantId }) => {
      window.localStorage.setItem("openmemory:apiUrl", apiUrl);
      window.localStorage.setItem("openmemory:tenantId", tenantId);
    },
    { apiUrl: API_URL, tenantId: tenant },
  );
  await page.goto(`/?view=graph&memoryId=${seeded.decision.id}`, {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByRole("heading", { name: "Memory Detail" }),
  ).toBeVisible();
  await expect(page.locator(".memory").first()).toContainText(
    "OpenMemory uses Durable Objects",
  );
  await expect(page.getByText("supports")).toBeVisible();

  expect(errors).toEqual([]);
});

async function seedTenant(tenant: string) {
  const memories = await Promise.all([
    createMemory(tenant, {
      type: "decision",
      tags: ["architecture", "cloudflare"],
      content:
        "OpenMemory uses Durable Objects as the tenant-scoped graph authority on Cloudflare.",
    }),
    createMemory(tenant, {
      type: "insight",
      tags: ["rag", "vectorize", "graph"],
      content:
        "Recall combines graph traversal, keyword matching, and Vectorize semantic retrieval.",
    }),
    createMemory(tenant, {
      type: "preference",
      tags: ["ui", "shadcn", "graph"],
      content:
        "The control plane should use shadcn primitives, TanStack data flows, charts, and a graph explorer.",
    }),
    createMemory(tenant, {
      type: "fact",
      tags: ["mcp"],
      content:
        "MCP clients call the Cloudflare-hosted OpenMemory API through the native MCP endpoint.",
    }),
  ]);

  await Promise.all([
    addEdge(tenant, {
      sourceId: memories[0].id,
      targetId: memories[1].id,
      relationship: "supports",
      weight: 0.91,
    }),
    addEdge(tenant, {
      sourceId: memories[1].id,
      targetId: memories[2].id,
      relationship: "informs",
      weight: 0.78,
    }),
    addEdge(tenant, {
      sourceId: memories[2].id,
      targetId: memories[3].id,
      relationship: "relates",
      weight: 0.64,
    }),
  ]);

  return {
    decision: memories[0],
    insight: memories[1],
    preference: memories[2],
    fact: memories[3],
  };
}

async function createMemory(
  tenant: string,
  body: { content: string; tags: string[]; type: string },
) {
  return apiJson<{ id: string }>(tenant, "/v1/memories", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function addEdge(
  tenant: string,
  body: {
    sourceId: string;
    targetId: string;
    relationship: string;
    weight: number;
  },
) {
  return apiJson(tenant, "/v1/graph/edges", {
    method: "POST",
    body: JSON.stringify({ ...body, metadata: { seededBy: "local-ui-e2e" } }),
  });
}

async function apiJson<T>(
  tenant: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-openmemory-user-id": tenant,
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path} failed: ${await response.text()}`,
    );
  }

  return response.json() as Promise<T>;
}
