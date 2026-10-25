import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

test("actual workerd maintenance gates assets and API, then serves normal application when explicitly open", async () => {
  const asset = (
    await readdir(resolve(root, "apps/web/dist/client/assets"))
  ).find((name) => name.endsWith(".js"));
  expect(asset).toBeDefined();
  const paths = [
    "/",
    "/dashboard",
    `/assets/${asset}`,
    "/health",
    "/v1/no-such-endpoint",
  ];
  const baseline = new Map<string, { status: number; body: string }>();
  const normal = await start("wrangler.jsonc");
  try {
    for (const path of paths) {
      const response = await normal.fetch(path);
      baseline.set(path, {
        status: response.status,
        body: await response.text(),
      });
    }
  } finally {
    await normal.stop();
  }
  expect(baseline.get("/health")?.status).toBe(200);
  expect(baseline.get(`/assets/${asset}`)?.status).toBe(200);
  const closed = await start("wrangler.maintenance.jsonc");
  try {
    for (const path of [
      ...paths,
      "/api/auth/get-session",
      "/mcp",
      "/login",
      "/consent",
      "/.well-known/oauth-authorization-server",
    ]) {
      for (const method of ["GET", "POST", "OPTIONS"]) {
        const response = await closed.fetch(path, { method });
        expect(response.status, `${method} ${path}`).toBe(503);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({ error: "maintenance" });
      }
    }
  } finally {
    await closed.stop();
  }
  const open = await start("wrangler.maintenance.jsonc", "open");
  try {
    for (const path of paths) {
      const response = await open.fetch(path);
      expect(response.status, path).toBe(baseline.get(path)?.status);
      const body = await response.text();
      expect(body, path).toBe(baseline.get(path)?.body);
    }
  } finally {
    await open.stop();
  }
}, 90_000);

async function start(config: string, mode?: string) {
  const state = await mkdtemp(`${tmpdir()}/openmemory-maintenance-`);
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((done) => socket.close(() => done()));
  const proc = spawn(
    resolve(root, "node_modules/.bin/wrangler"),
    [
      "dev",
      "--local",
      "--config",
      config,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      "0",
      "--persist-to",
      state,
      "--show-interactive-dev-session=false",
      ...(mode ? ["--var", `OPENMEMORY_TRAFFIC_MODE:${mode}`] : []),
    ],
    {
      cwd: root,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  proc.stdout.on("data", (chunk) => {
    output += chunk;
  });
  proc.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const exited = new Promise<void>((done) => proc.once("exit", () => done()));
  const stop = async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill("SIGTERM");
      await Promise.race([exited, delay(3000)]);
      if (proc.exitCode === null && proc.signalCode === null)
        proc.kill("SIGKILL");
      await exited;
    }
    await rm(state, { recursive: true, force: true });
  };
  const request = (path: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (proc.exitCode !== null) throw new Error(output);
      try {
        const response = await request("/health");
        ready =
          response.status ===
          (config === "wrangler.maintenance.jsonc" && !mode ? 503 : 200);
        await response.arrayBuffer();
      } catch {
        /* Startup polling. */
      }
      if (ready) break;
      await delay(250);
    }
    if (!ready)
      throw new Error(`Maintenance workerd startup failed: ${output}`);
  } catch (error) {
    await stop();
    throw error;
  }
  return { fetch: request, stop };
}
