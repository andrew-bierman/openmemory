import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";

const core = vi.hoisted(() => ({
  fetch: vi.fn(() => new Response("application")),
  queue: vi.fn(),
  scheduled: vi.fn(),
}));
vi.mock("../src/index", () => ({
  default: core,
  MemoryGraph: class {},
  MemoryExtractionWorkflow: class {},
  SourceIngestionWorkflow: class {},
}));

// Dynamic paths keep Worker-only globals out of the Node test TypeScript project.
const app = await import("../src/" + "index");
const { default: maintenance, ...bridge } = await import(
  "../src/" + "maintenance"
);

const context = {} as never;
const controller = {} as never;
const assets = { fetch: vi.fn(() => new Response("asset")) };
const batch = { retryAll: vi.fn(), ackAll: vi.fn() };
beforeEach(() => vi.clearAllMocks());
test.each([
  undefined,
  "closed",
  "OPEN",
  " open",
  "open ",
  "",
])("fails closed for mode %s across HTTP, queues, cron", async (mode) => {
  const env = { OPENMEMORY_TRAFFIC_MODE: mode, ASSETS: assets } as never;
  for (const path of [
    "/",
    "/assets/main.js",
    "/health",
    "/v1/memories",
    "/mcp",
    "/api/auth/sign-in/email",
    "/arbitrary/spa",
  ]) {
    const response = await maintenance.fetch(
      new Request(`https://example.test${path}`, { method: "POST" }),
      env,
      context,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("300");
  }
  await maintenance.queue(batch as never, env);
  maintenance.scheduled(controller, env, context);
  expect(batch.retryAll).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 300 });
  expect(batch.ackAll).not.toHaveBeenCalled();
  expect(core.fetch).not.toHaveBeenCalled();
  expect(core.queue).not.toHaveBeenCalled();
  expect(core.scheduled).not.toHaveBeenCalled();
  expect(assets.fetch).not.toHaveBeenCalled();
});
test("exact open preserves application routes, asset routes and event handlers", async () => {
  const env = { OPENMEMORY_TRAFFIC_MODE: "open", ASSETS: assets } as never;
  const config = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, "../../../wrangler.jsonc"),
      "utf8",
    ),
  );
  for (const pattern of config.assets.run_worker_first) {
    const path = pattern.replace("*", "probe");
    expect(
      await (
        await maintenance.fetch(
          new Request(`https://example.test${path}`),
          env,
          context,
        )
      ).text(),
    ).toBe("application");
  }
  for (const path of [
    "/",
    "/assets/app.js",
    "/dashboard",
    "/login/nested",
    "/health/nested",
    "/v10",
  ])
    expect(
      await (
        await maintenance.fetch(
          new Request(`https://example.test${path}`),
          env,
          context,
        )
      ).text(),
    ).toBe("asset");
  await maintenance.queue(batch as never, env);
  maintenance.scheduled(controller, env, context);
  expect(core.queue).toHaveBeenCalledExactlyOnceWith(batch, env);
  expect(core.scheduled).toHaveBeenCalledExactlyOnceWith(
    controller,
    env,
    context,
  );
  expect(batch.retryAll).not.toHaveBeenCalled();
});
test("bridge reexports the same classes and config preserves existing bindings", () => {
  for (const key of [
    "MemoryGraph",
    "MemoryExtractionWorkflow",
    "SourceIngestionWorkflow",
  ] as const)
    expect(bridge[key]).toBe(app[key]);
  const read = (file: string) =>
    JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../..", file), "utf8"),
    );
  const base = read("wrangler.jsonc"),
    maintenanceConfig = read("wrangler.maintenance.jsonc");
  expect(maintenanceConfig).toEqual({
    ...base,
    main: "apps/api/src/maintenance.ts",
    assets: { ...base.assets, binding: "ASSETS", run_worker_first: true },
    vars: { ...base.vars, OPENMEMORY_TRAFFIC_MODE: "closed" },
  });
});
