import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

// Exercise the actual Worker queue entry point in workerd. Only downstream
// workflow bindings and source-job storage are replaced; no hosted resources or
// credentials are used.
test("queue routing honors isolated names and rejects ambiguous or unknown delivery", async () => {
  const state = await mkdtemp(`${tmpdir()}/openmemory-queue-routing-`);
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((done) => socket.close(() => done()));
  const main = resolve(state, "probe.ts");
  await writeFile(
    main,
    `
    import app from ${JSON.stringify(resolve(root, "apps/api/src/index.ts"))};
    export default {
      async fetch(request) {
        if (new URL(request.url).pathname === "/health") return new Response("ok");
        const { queue, vars, fail } = await request.json();
        const calls = [];
        let acked = 0, retried = 0;
        const workflow = (kind) => ({ create: async ({ params }) => {
          calls.push({ kind, params });
          if (fail) throw new Error("workflow unavailable");
        }});
        const env = {
          ...vars,
          MEMORY_GRAPHS: { idFromName: (name) => name, get: () => ({
            startIngestionJob: async () => ({ generation: 0 }),
          }) },
          MEMORY_EXTRACTION_WORKFLOW: workflow("extraction"),
          SOURCE_INGESTION_WORKFLOW: workflow("source"),
        };
        const batch = { queue, messages: [{
          body: { version: 1, tenantId: "synthetic", memoryId: "memory-1",
            sourceId: "source-1", input: { content: "Synthetic source." },
            reason: "create", requestedAt: "2026-10-17T00:00:00Z" },
          attempts: 1, ack: () => acked++, retry: () => retried++,
        }] };
        let error = null;
        try { await app.queue(batch, env); }
        catch (caught) { error = caught.message; }
        return Response.json({ calls, acked, retried, error });
      }
    };
  `,
  );
  const config = resolve(state, "wrangler.json");
  await writeFile(
    config,
    JSON.stringify({
      name: "openmemory-local-queue-probe",
      main,
      compatibility_date: "2026-06-01",
      compatibility_flags: ["nodejs_compat"],
    }),
  );
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
      resolve(state, "state"),
      "--show-interactive-dev-session=false",
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
        ready = response.ok;
        await response.arrayBuffer();
      } catch {
        /* Startup polling. */
      }
      if (ready) break;
      await delay(250);
    }
    if (!ready) throw new Error(`Queue probe startup failed: ${output}`);
    const check = async (
      queue: string,
      vars: Record<string, string> = {},
      fail = false,
    ) => {
      const response = await request("/queue", {
        method: "POST",
        body: JSON.stringify({ queue, vars, fail }),
      });
      expect(response.status).toBe(200);
      return (await response.json()) as {
        calls: { kind: string; params: Record<string, unknown> }[];
        acked: number;
        retried: number;
        error: string | null;
      };
    };
    const staging = {
      MEMORY_EXTRACTION_QUEUE_NAME: "isolated-extraction",
      SOURCE_INGESTION_QUEUE_NAME: "isolated-source",
    };
    for (const [queue, kind, vars] of [
      ["openmemory-memory-extraction", "extraction", {}],
      ["openmemory-source-ingestion", "source", {}],
      ["isolated-extraction", "extraction", staging],
      ["isolated-source", "source", staging],
      [
        "isolated-extraction",
        "extraction",
        { MEMORY_EXTRACTION_QUEUE_NAME: "isolated-extraction" },
      ],
      [
        "openmemory-source-ingestion",
        "source",
        { MEMORY_EXTRACTION_QUEUE_NAME: "isolated-extraction" },
      ],
    ] as const) {
      const result = await check(queue, vars);
      expect(result, queue).toMatchObject({
        acked: 1,
        retried: 0,
        error: null,
      });
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0]).toMatchObject({
        kind,
        params: { tenantId: "synthetic" },
      });
    }
    for (const [queue, vars] of [
      ["unexpected", {}],
      ["openmemory-memory-extraction", staging],
      ["openmemory-source-ingestion", staging],
      [
        "same",
        {
          MEMORY_EXTRACTION_QUEUE_NAME: "same",
          SOURCE_INGESTION_QUEUE_NAME: "same",
        },
      ],
      ["openmemory-source-ingestion", { MEMORY_EXTRACTION_QUEUE_NAME: "" }],
      ["openmemory-memory-extraction", { SOURCE_INGESTION_QUEUE_NAME: "" }],
    ] as const) {
      const result = await check(queue, vars);
      expect(result).toMatchObject({ calls: [], acked: 0, retried: 0 });
      expect(result.error).toBeTruthy();
    }
    const failed = await check("isolated-extraction", staging, true);
    expect(failed).toMatchObject({ acked: 0, retried: 1, error: null });
    expect(failed.calls).toHaveLength(1);
    expect(failed.calls[0]?.kind).toBe("extraction");
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill("SIGTERM");
      await Promise.race([exited, delay(3000)]);
      if (proc.exitCode === null && proc.signalCode === null)
        proc.kill("SIGKILL");
      await exited;
    }
    await rm(state, { recursive: true, force: true });
  }
}, 60_000);
