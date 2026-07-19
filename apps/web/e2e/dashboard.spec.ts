import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const API_URL = "http://127.0.0.1:54150";
const MCP_URL = `${API_URL}/mcp`;
const OAUTH_ISSUER_URL = `${API_URL}/api/auth`;
const AUTHORIZATION_METADATA_URL = `${API_URL}/.well-known/oauth-authorization-server/api/auth`;
const PROTECTED_RESOURCE_METADATA_URL = `${API_URL}/.well-known/oauth-protected-resource/mcp`;

test("local dashboard renders TanStack table, charts, and graph explorer", async ({
  page,
}) => {
  const tenant = `ui-e2e-${crypto.randomUUID()}`;
  const screenshotDir = ".tmp/screenshots/launch-readiness";
  const errors: string[] = [];
  await mkdir(screenshotDir, { recursive: true });

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("401") &&
      !message.text().includes("Unauthorized") &&
      !message.text().includes("Failed to load resource") &&
      !message.text().includes("has been blocked by CORS policy")
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
  await expect(page.locator(".recharts-wrapper")).toHaveCount(3);
  await expect(page.getByText("Total captures")).toBeVisible();
  await expect(page.getByText("Leading type")).toBeVisible();
  await expect(page.getByText("Current index")).toBeVisible();
  await expect(page.getByLabel("Memory lifecycle status")).toBeVisible();
  await expect(page.getByLabel("Graph health signals")).toContainText(
    "Edge density",
  );
  await expect(page.getByLabel("Relationship readiness signals")).toContainText(
    "Relationship diversity",
  );
  await expect(page.getByLabel("Index readiness signals")).toContainText(
    "Current share",
  );
  await expect(page.getByLabel("Memory type ranking")).toBeVisible();
  await expect(page.getByLabel("Memory lifecycle ranking")).toContainText(
    "active",
  );
  await expect(page.locator("tbody tr")).toHaveCount(4);
  await expect(page.getByText("4 of 4 rows")).toBeVisible();
  await expect(page.getByLabel("Rows per page")).toHaveValue("5");
  await expect(page.getByText("Page 1 of 1")).toBeVisible();
  await page.getByLabel("Rows per page").selectOption("10");
  await expect(page.getByLabel("Rows per page")).toHaveValue("10");
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDir}/01-recall-dashboard.png`,
  });

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
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByText("4 of 4 rows")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(4);

  await page
    .locator(".tabs")
    .getByRole("button", { name: "Knowledge Map", exact: true })
    .click();
  await expect(page.locator(".graph-controls input")).toBeVisible();
  await expect(page.getByLabel("Graph operations dashboard")).toContainText(
    "Benchmark status",
  );
  await expect(page.locator(".graph-controls select")).toHaveCount(2);
  await expect(page.locator(".force-graph-frame canvas")).toHaveCount(1);
  await expect(page.getByLabel("Graph relationship summary")).toBeVisible();
  await expect(page.getByLabel("Visible relationship types")).toContainText(
    "shared-signal",
  );
  await expect(page.locator(".graph-node-card")).toHaveCount(4);
  await page
    .getByLabel("Filter graph by relationship")
    .selectOption("shared-signal");
  await expect(page).toHaveURL(/graphRelationship=shared-signal/);
  await expect(page.getByLabel("Visible relationship types")).toContainText(
    "shared-signal",
  );
  await page.getByLabel("Filter graph by relationship").selectOption("all");

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

  const emptyGraphExport = {
    version: 1,
    exportedAt: "2026-07-18T00:00:00.000Z",
    memories: [],
    edges: [],
  };
  const importPanel = page.getByRole("region", {
    exact: true,
    name: "Graph import preview",
  });
  const importSummary = page.getByRole("region", {
    exact: true,
    name: "Graph import preview summary",
  });
  await expect(importPanel).toBeVisible();
  await page.getByLabel("Confirm tenant id").fill(tenant);
  await expect(page.getByLabel("Import mode")).toHaveValue("merge");
  await expect(page.getByLabel("Conflict policy")).toHaveValue("skip");
  await page
    .getByLabel("Graph export JSON")
    .fill(JSON.stringify(emptyGraphExport));
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(importPanel).toContainText("Merge is ready");
  await expect(importSummary).toContainText("Incoming");

  await page.getByRole("button", { name: "Fit graph" }).click();
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDir}/02-knowledge-map-filtered.png`,
  });

  await page
    .locator(".tabs")
    .getByRole("button", { name: "Admin", exact: true })
    .click();
  await expect(page).toHaveURL(/view=admin/);
  const adminGrid = page.locator(".admin-grid");
  await expect(adminGrid).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, name: "Account" }),
  ).toBeVisible();
  await expect(adminGrid.getByLabel("API URL")).toHaveValue(API_URL);
  await expect(adminGrid.getByLabel("Local tenant")).toHaveValue(tenant);
  await expect(
    page.getByText("Header tenant for local development"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Team and tenant" }),
  ).toBeVisible();
  await expect(page.getByLabel("Workspace name")).toHaveValue(
    "Local workspace",
  );
  await expect(page.getByLabel("Display name")).toBeDisabled();
  await expect(page.getByLabel("Member email")).toBeDisabled();
  await expect(page.getByLabel("Role")).toBeDisabled();
  await expect(page.getByText("No hosted workspace loaded")).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDir}/03-admin-local-mode.png`,
  });

  await page
    .locator(".tabs")
    .getByRole("button", { name: "MCP", exact: true })
    .click();
  await expect(page).toHaveURL(/view=mcp/);
  await expect(page.getByLabel("Server URL")).toHaveValue(MCP_URL);
  await expect(page.getByLabel("OAuth issuer")).toHaveValue(OAUTH_ISSUER_URL);
  await expect(page.getByLabel("Authorization metadata")).toHaveValue(
    AUTHORIZATION_METADATA_URL,
  );
  await expect(page.getByLabel("Protected resource metadata")).toHaveValue(
    PROTECTED_RESOURCE_METADATA_URL,
  );
  await expect(page.locator("pre.context").first()).toContainText(
    AUTHORIZATION_METADATA_URL,
  );
  await expect(page.locator("pre.context").first()).toContainText(
    PROTECTED_RESOURCE_METADATA_URL,
  );
  await expect(page.getByLabel("Client name")).toHaveValue(
    "OpenMemory MCP Client",
  );
  await expect(page.getByLabel("Client name")).toBeDisabled();
  await expect(page.getByLabel("Redirect URIs")).toHaveValue(
    "http://127.0.0.1:39123/callback",
  );
  await expect(
    page.getByRole("button", { name: "Create client" }),
  ).toBeDisabled();
  await expect(page.getByText("Sign in to register clients")).toBeVisible();
  await expect(page.getByText("No authorized clients")).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDir}/04-mcp-setup.png`,
  });

  await page
    .locator(".tabs")
    .getByRole("button", { name: "Operations", exact: true })
    .click();
  await expect(page).toHaveURL(/view=operations/);
  await expect(page.getByLabel("Operations readiness")).toContainText(
    "Launch readiness",
  );
  await expect(page.getByText("Cloudflare bindings")).toBeVisible();
  await expect(page.getByText("MCP discovery")).toBeVisible();
  await expect(page.getByText("Tenant and auth")).toBeVisible();
  await expect(page.locator(".binding-grid")).toContainText("Durable Objects");
  await expect(page.locator(".binding-grid")).toContainText(
    "Source Ingestion Queue",
  );
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDir}/05-operations-readiness.png`,
  });

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

  await page.goto("/?view=graph&graphSearch=cloudflare&graphType=decision");
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
    {
      apiUrl: API_URL,
      tenantId: `empty-ui-e2e-${crypto.randomUUID()}`,
    },
  );
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("Start your memory graph")).toBeVisible();
  await expect(page.getByText("Connect MCP after OAuth sign-in")).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDir}/06-empty-state.png`,
  });

  await page.getByLabel("Tenant").fill(tenant);
  await page.getByRole("button", { name: /refresh/i }).click();
  await expect(page.locator("tbody tr")).toHaveCount(4);
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
  await expect(page.getByLabel("Selected memory graph detail")).toContainText(
    "OpenMemory uses Durable Objects",
  );
  await expect(page.getByLabel("Selected memory relationships")).toContainText(
    "Supports",
  );
  await page
    .getByLabel("Filter graph by relationship")
    .selectOption("supports");
  await expect(page).toHaveURL(/graphRelationship=supports/);
  await expect(page.getByLabel("Filter graph by relationship")).toHaveValue(
    "supports",
  );
  await expect(page.getByLabel("Visible relationship types")).toContainText(
    "supports",
  );
  await expect(page.getByLabel("Graph neighbor relationships")).toContainText(
    "supports",
  );
  await expect(page.getByLabel("Graph neighbor relationships")).toContainText(
    "Recall combines graph traversal",
  );
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDir}/07-selected-memory-graph.png`,
  });
  const neighborInspectButtons = page
    .getByLabel("Graph neighbor relationships")
    .getByRole("button", { name: "Inspect" });
  await expect
    .poll(() => neighborInspectButtons.count(), {
      message: "expected graph neighbor inspect controls",
    })
    .toBeGreaterThanOrEqual(2);
  await expect(neighborInspectButtons.first()).toBeVisible();

  await page
    .locator(".tabs")
    .getByRole("button", { name: "Ingest", exact: true })
    .click();
  await expect(page).toHaveURL(/view=ingest/);
  await expect(page.getByLabel("Source ingest summary")).toContainText(
    "No ingest yet",
  );
  await expect(page.getByLabel("Mode")).toHaveValue("conversation");
  await expect(page.getByLabel("Conversation id")).toHaveValue(/conversation-/);
  await page
    .getByRole("textbox", { name: "Source" })
    .fill("architecture-notes");
  await page
    .getByLabel("Content")
    .fill(
      [
        "Source ingestion should preserve provenance and chunk long-form notes.",
        "Graph edges should connect adjacent chunks and related concepts for recall.",
        "Operators need a visible summary when documents enter the memory graph.",
      ].join("\\n\\n"),
    );
  await page
    .locator(".panel form")
    .getByRole("button", {
      name: "Ingest",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Source ingest summary")).toContainText(
    "Ingestion indexed",
  );
  await expect(page.getByLabel("Source ingest summary")).toContainText(
    "Chunks",
  );
  await expect(page.getByLabel("Source ingest summary")).toContainText("Edges");
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDir}/08-ingest-source.png`,
  });
  await page.getByRole("button", { name: "Inspect first chunk" }).click();
  await expect(page).toHaveURL(/view=graph/);
  await expect(page).toHaveURL(/memoryId=/);

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/?view=operations", { waitUntil: "networkidle" });
  await expect(page.getByLabel("Operations readiness")).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDir}/09-mobile-operations.png`,
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 2,
        ),
      { message: "mobile dashboard should not scroll horizontally" },
    )
    .toBe(true);

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
      relationship: "uses",
      weight: 0.78,
    }),
    addEdge(tenant, {
      sourceId: memories[2].id,
      targetId: memories[3].id,
      relationship: "extends",
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
