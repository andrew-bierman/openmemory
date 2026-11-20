import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

test("real Durable Object rejects stale ingestion writes and completion after purge, across restart", async () => {
  const state = await mkdtemp(`${tmpdir()}/openmemory-fence-`);
  let worker = await start(state);
  try {
    const a = (
      operation: string,
      input?: unknown,
      generation?: number,
      sourceId = "same-source",
    ) =>
      worker.call({
        tenant: "tenant-a",
        operation,
        input,
        generation,
        sourceId,
      });
    const b = (operation: string, input?: unknown, generation?: number) =>
      worker.call({ tenant: "tenant-b", operation, input, generation });
    expect(await (await a("generation")).json()).toBe(0);
    const job = (await (await a("job", { content: "old source" })).json()) as {
      generation: number;
    };
    expect(job.generation).toBe(0);
    expect((await a("start", undefined, 0)).status).toBe(200);
    expect((await a("create", { content: "before purge" }, 0)).status).toBe(
      200,
    );
    expect((await b("create", { content: "unrelated tenant" }, 0)).status).toBe(
      200,
    );
    expect((await a("purge")).status).toBe(200);
    expect(await (await a("generation")).json()).toBe(1);
    await a("job", { content: "new source with reused job id" });

    for (const [operation, input] of [
      ["create", { content: "late chunk" }],
      [
        "edge",
        { sourceId: "old-a", targetId: "old-b", relationship: "related_to" },
      ],
      ["complete", { memories: [], edges: [], chunkCount: 9 }],
      ["fail", { message: "late old failure" }],
    ] as const) {
      const response = await a(operation, input, 0);
      expect(response.status, operation).toBe(409);
      expect(await response.json()).toMatchObject({
        error: "ingestion_cancelled_by_purge",
      });
    }
    expect((await a("complete", { chunkCount: 9 })).status).toBe(409);
    expect((await a("fail", { message: "legacy late failure" })).status).toBe(
      409,
    );
    expect(await (await a("start", undefined, 0)).json()).toBeNull();
    expect(await (await a("start")).json()).toBeNull();
    expect(await (await a("list")).json()).toEqual([]);
    expect(await (await a("get-job")).json()).toMatchObject({
      status: "queued",
    });
    expect(await (await b("generation")).json()).toBe(0);
    expect(await (await b("list")).json()).toHaveLength(1);

    await worker.stop();
    worker = await start(state);
    expect(await (await a("generation")).json()).toBe(1);
    expect(
      (await a("create", { content: "late after process restart" }, 0)).status,
    ).toBe(409);
    expect(
      (await a("create", { content: "fresh after restart" }, 1)).status,
    ).toBe(200);
    expect((await a("start", undefined, 1)).status).toBe(200);
    expect(
      (await a("complete", { memories: [], edges: [], chunkCount: 0 }, 1))
        .status,
    ).toBe(200);
    expect(await (await a("get-job")).json()).toMatchObject({
      status: "completed",
    });
    expect(await (await a("start", undefined, 1)).json()).toBeNull();
    expect(await (await b("list")).json()).toHaveLength(1);
    const snapshot = (await (await a("export")).json()) as {
      memories: Array<{ id: string; content: string }>;
    };
    await a("restore", snapshot);
    const restoredGeneration = (await (await a("generation")).json()) as number;
    const restoredId = snapshot.memories[0].id;
    const signals = { tags: ["new"], entityIds: [], relationships: [] };
    expect((await a("extract", signals, 1, restoredId)).status).toBe(409);
    expect(
      (await a("extract", signals, restoredGeneration, restoredId)).status,
    ).toBe(200);
    expect(await (await a("list")).json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: "fresh after restart" }),
      ]),
    );

    await a("retire");
    const deletedGeneration = (await (await a("generation")).json()) as number;
    // Even a previously authenticated caller that captures the NEW generation
    // cannot recreate a deleted account. Ordinary tenant purge remains reusable.
    for (const [operation, input] of [
      ["create", { content: "late MCP remember" }],
      ["job", { content: "late source" }],
      ["restore", snapshot],
    ] as const) {
      const response = await a(operation, input, deletedGeneration);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "tenant_deleted" });
    }
    expect(
      (await a("create", { content: "legacy unfenced write" })).status,
    ).toBe(409);
    await worker.stop();
    worker = await start(state);
    expect(
      (await a("create", { content: "retired across restart" })).status,
    ).toBe(409);
    expect(await (await a("list")).json()).toEqual([]);
    expect(await (await b("list")).json()).toHaveLength(1);
  } finally {
    await worker.stop();
    await rm(state, { recursive: true, force: true });
  }
}, 60_000);

async function start(state: string) {
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
      "apps/api/test/fixtures/wrangler.fence.jsonc",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      "0",
      "--persist-to",
      state,
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
  const stop = async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill("SIGTERM");
      await Promise.race([exited, delay(3000)]);
      if (proc.exitCode === null && proc.signalCode === null)
        proc.kill("SIGKILL");
      await exited;
    }
  };
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (proc.exitCode !== null) throw new Error(output);
      try {
        ready = (
          await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) })
        ).ok;
      } catch {
        /* Startup polling. */
      }
      if (ready) break;
      await delay(250);
    }
    if (!ready) throw new Error(`Fence fixture did not start: ${output}`);
  } catch (error) {
    await stop();
    throw error;
  }
  return {
    stop,
    call: (body: unknown) =>
      fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      }),
  };
}
