import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "vitest";

type TestRecord = {
  id: string;
  content: string;
  type: string;
  shareId: string;
  memories: Array<{ id: string; content: string }>;
};

const root = resolve(import.meta.dirname, "../../..");

test("owner grants isolate selected versions and survive revocation, restore and restart safely", async () => {
  const state = await mkdtemp(`${tmpdir()}/openmemory-shares-`);
  let worker = await start(state);
  try {
    const call = async <T = TestRecord>(
      operation: string,
      input?: unknown,
      extra: Record<string, unknown> = {},
    ) => {
      const response = await worker.call({
        tenant: "a",
        operation,
        input,
        ...extra,
      });
      return { status: response.status, body: (await response.json()) as T };
    };
    const memory = (
      await call("create", {
        content: "selected",
        tags: ["public"],
        metadata: { secret: "hidden" },
        entityIds: ["private-entity"],
        source: "private-source",
      })
    ).body;
    const neighbor = (await call("create", { content: "private neighbor" }))
      .body;
    await call("edge", {
      sourceId: memory.id,
      targetId: neighbor.id,
      relationship: "related_to",
    });
    const intent = {
      memoryId: memory.id,
      workspaceId: "workspace",
      ownerMembershipId: "member-1",
      requestId: "intent-1",
      generation: 0,
    };
    for (const invalid of [
      { ...intent, requestId: "" },
      { ...intent, requestId: "x".repeat(129) },
      { ...intent, generation: undefined },
      { ...intent, generation: -1 },
      { ...intent, generation: 0.5 },
      { ...intent, generation: 1 },
    ])
      expect((await call("share", invalid)).status).toBe(409);
    const shared = await call("share", intent);
    expect(shared.status).toBe(200);
    expect(shared.body).toEqual({
      shareId: expect.any(String),
      workspaceId: "workspace",
      memoryId: memory.id,
      content: "selected",
      type: memory.type,
      tags: ["public"],
      ownerMembershipId: "member-1",
      generation: 0,
    });
    const concurrent = await Promise.all([
      call("share", intent),
      call("share", intent),
    ]);
    expect(concurrent.map((r) => r.body)).toEqual([shared.body, shared.body]);
    expect(
      (await call("share", { ...intent, ownerMembershipId: "member-rejoined" }))
        .status,
    ).toBe(409);
    const otherMemory = (
      await call("create", { content: "tenant B own content" }, { tenant: "b" })
    ).body;
    const otherShare = (
      await call(
        "share",
        { ...intent, memoryId: otherMemory.id },
        { tenant: "b" },
      )
    ).body;
    expect(otherShare.shareId).not.toBe(shared.body.shareId);
    const key = { shareId: shared.body.shareId, workspaceId: "workspace" };
    expect((await call("share", intent)).body).toEqual(shared.body);
    expect(
      (await call("share", { ...intent, workspaceId: "other" })).status,
    ).toBe(409);
    expect(
      (await call("read-share", undefined, { ...key, tenant: "b" })).body,
    ).toBeNull();
    expect(
      (await call("read-share", undefined, { ...key, workspaceId: "other" }))
        .body,
    ).toBeNull();
    expect(
      (
        await call(
          "share",
          {
            ...intent,
            requestId: "foreign",
            memoryId: neighbor.id,
            tenant: "b",
          },
          { tenant: "b" },
        )
      ).status,
    ).toBe(409);
    const personalExport = (await call("export")).body;
    expect(personalExport).not.toHaveProperty("shares");
    expect(JSON.stringify(personalExport)).not.toContain(shared.body.shareId);
    expect(JSON.stringify(personalExport)).not.toContain("member-1");
    await call("revoke-share", undefined, key);
    await call("revoke-share", undefined, key);
    expect((await call("read-share", undefined, key)).body).toBeNull();
    expect((await call("share", intent)).status).toBe(409);
    const renewed = (await call("share", { ...intent, requestId: "intent-2" }))
      .body;
    expect(renewed.shareId).not.toBe(shared.body.shareId);
    const renewedKey = { ...key, shareId: renewed.shareId };
    await call(
      "update",
      { content: "new version", relationship: "updates" },
      { sourceId: memory.id },
    );
    expect((await call("read-share", undefined, renewedKey)).body).toBeNull();
    expect(
      (await call("share", { ...intent, requestId: "old-version" })).status,
    ).toBe(409);
    const forgottenShare = (
      await call("share", {
        ...intent,
        memoryId: neighbor.id,
        requestId: "forget",
      })
    ).body;
    await call("forget", undefined, { sourceId: neighbor.id });
    expect(
      (
        await call("read-share", undefined, {
          ...key,
          shareId: forgottenShare.shareId,
        })
      ).body,
    ).toBeNull();
    expect(
      (
        await call("share", {
          ...intent,
          memoryId: neighbor.id,
          requestId: "forgotten",
        })
      ).status,
    ).toBe(409);
    const fresh = (await call("create", { content: "restore selected" })).body;
    const freshIntent = { ...intent, memoryId: fresh.id, requestId: "restore" };
    const restoreShare = (await call("share", freshIntent)).body;
    const snapshot = (await call("export")).body;
    await call("restore", snapshot);
    expect(
      (
        await call("read-share", undefined, {
          ...key,
          shareId: restoreShare.shareId,
        })
      ).body,
    ).toBeNull();
    expect((await call("share", freshIntent)).status).toBe(409);
    const generation = (await call<number>("generation")).body;
    // A repeated HTTP request captures today's generation. That must not turn
    // yesterday's consumed intent into fresh permission after restore.
    expect((await call("share", { ...freshIntent, generation })).status).toBe(
      409,
    );
    await worker.stop();
    worker = await start(state);
    expect((await call("share", { ...freshIntent, generation })).status).toBe(
      409,
    );
    const newShare = (
      await call("share", {
        ...freshIntent,
        generation,
        requestId: "explicit-after-restore",
      })
    ).body;
    expect(newShare.shareId).not.toBe(restoreShare.shareId);
    const changed = structuredClone(snapshot);
    const changedMemory = changed.memories.find((m) => m.id === fresh.id);
    if (!changedMemory) throw new Error("fixture memory missing");
    changedMemory.content = "import overwritten";
    await call("merge", changed);
    expect(
      (
        await call("read-share", undefined, {
          ...key,
          shareId: newShare.shareId,
        })
      ).body,
    ).toBeNull();
    const last = (
      await call("share", { ...freshIntent, generation, requestId: "last" })
    ).body;
    await worker.stop();
    worker = await start(state);
    expect(
      (await call("read-share", undefined, { ...key, shareId: last.shareId }))
        .body.content,
    ).toBe("import overwritten");
    await call("retire");
    await worker.stop();
    worker = await start(state);
    expect(
      (await call("read-share", undefined, { ...key, shareId: last.shareId }))
        .body,
    ).toBeNull();
    expect(
      (
        await call("share", {
          ...freshIntent,
          generation: (await call<number>("generation")).body,
          requestId: "retired",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("read-share", undefined, {
          tenant: "b",
          workspaceId: "workspace",
          shareId: otherShare.shareId,
        })
      ).body.content,
    ).toBe("tenant B own content");
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
      "apps/api/test/fixtures/wrangler.shared-grants.jsonc",
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
