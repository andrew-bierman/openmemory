import { beforeEach, expect, test, vi } from "vitest";
import type { Env } from "../src/env";
import {
  createSharedMemory,
  listSharedMemories,
  readSharedMemory,
  revokeSharedMemory,
} from "../src/workspace-sharing";

const state = vi.hoisted(() => ({ members: new Map<string, string>() }));
vi.mock("../src/workspace-access", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/workspace-access")>();
  return {
    ...actual,
    getWorkspaceAccess: vi.fn(
      async (_env: Env, id: string, workspaceId: string) =>
        state.members.has(id) && workspaceId === "team"
          ? {
              workspaceId,
              ownerUserId: "owner",
              memberId: state.members.get(id),
              role: "member",
            }
          : undefined,
    ),
  };
});
beforeEach(() => {
  state.members.clear();
  state.members.set("owner", "owner-1");
  state.members.set("reader", "reader-1");
});
function fixture() {
  let revoked = false;
  const row = {
    share_id: "share",
    owner_user_id: "owner",
    workspace_id: "team",
    memory_id: "memory",
    created_at: 1,
  };
  const projection = {
    shareId: "share",
    workspaceId: "team",
    memoryId: "memory",
    content: "selected launch plan",
    type: "fact",
    tags: ["launch"],
    ownerMembershipId: "owner-1",
    generation: 0,
    metadata: { secret: "private" },
    source: "private",
    entityIds: ["secret"],
    edges: ["private"],
  };
  const graph = {
    getIngestionGeneration: vi.fn(async () => 0),
    createMemoryShare: vi.fn(async () => projection),
    readMemoryShare: vi.fn(async (_shareId?: string, _workspaceId?: string) =>
      revoked ? undefined : projection,
    ),
    revokeMemoryShare: vi.fn(async () => {
      revoked = true;
      return { revoked: true };
    }),
  };
  const db = {
    prepare: vi.fn((_sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: async () => (args.includes("other") ? null : row),
        all: async () => ({ results: [row] }),
        run: async () => ({ success: true, meta: { changes: 1 } }),
      })),
    })),
  };
  const env = {
    AUTH_DB: db,
    MEMORY_GRAPHS: { idFromName: (id: string) => id, get: vi.fn(() => graph) },
  } as unknown as Env;
  return {
    env,
    graph,
    db,
    projection,
    revoke: () => {
      revoked = true;
    },
  };
}
test("shared reads project only selected content and explicit owner attribution", async () => {
  const f = fixture();
  const item = await readSharedMemory(f.env, "reader", "team", "share");
  expect(item).toEqual({
    shareId: "share",
    workspaceId: "team",
    ownerUserId: "owner",
    memoryId: "memory",
    content: "selected launch plan",
    type: "fact",
    tags: ["launch"],
  });
  expect(
    await readSharedMemory(f.env, "reader", "team", "other"),
  ).toBeUndefined();
  await expect(
    readSharedMemory(f.env, "outsider", "team", "share"),
  ).rejects.toMatchObject({ status: 404 });
});
test("share creation selects only the authenticated owner's graph and checks membership", async () => {
  const f = fixture();
  await createSharedMemory(f.env, "owner", "team", {
    memoryId: "memory",
    requestId: "intent",
  });
  expect(f.env.MEMORY_GRAPHS.get).toHaveBeenCalledWith("owner");
  expect(f.graph.createMemoryShare).toHaveBeenCalledWith({
    memoryId: "memory",
    workspaceId: "team",
    ownerMembershipId: "owner-1",
    requestId: "intent",
    generation: 0,
  });
  await expect(
    createSharedMemory(f.env, "outsider", "team", {
      memoryId: "memory",
      requestId: "intent",
    }),
  ).rejects.toMatchObject({ status: 404 });
});
test("membership removal and sharer rejoin cannot revive or finish an old shared read", async () => {
  const f = fixture();
  let release!: () => void;
  let reached!: () => void;
  const started = new Promise<void>((r) => {
    reached = r;
  });
  f.graph.readMemoryShare.mockImplementationOnce(async () => {
    reached();
    await new Promise<void>((r) => {
      release = r;
    });
    return f.projection;
  });
  const pending = readSharedMemory(f.env, "reader", "team", "share");
  await started;
  state.members.delete("reader");
  release();
  expect(await pending).toBeUndefined();
  state.members.set("reader", "reader-1");
  state.members.set("owner", "owner-2");
  expect(
    await readSharedMemory(f.env, "reader", "team", "share"),
  ).toBeUndefined();
});
test("revocation between checks suppresses content and stale directory cannot authorize", async () => {
  const f = fixture();
  f.graph.readMemoryShare.mockImplementationOnce(async () => {
    f.revoke();
    return f.projection;
  });
  expect(
    await readSharedMemory(f.env, "reader", "team", "share"),
  ).toBeUndefined();
  expect((await listSharedMemories(f.env, "reader", "team", {})).items).toEqual(
    [],
  );
});
test("page search is authorized-only and rejects cross-workspace cursors", async () => {
  const f = fixture();
  const page = await listSharedMemories(f.env, "reader", "team", {
    q: "launch",
    limit: 1,
  });
  expect(page.items).toHaveLength(1);
  expect(page.ranking).toBe("page-local");
  expect(
    (await listSharedMemories(f.env, "reader", "team", { q: "private" })).items,
  ).toEqual([]);
  await expect(
    listSharedMemories(f.env, "reader", "team", {
      cursor: btoa(JSON.stringify(["other", 1, "share"])),
    }),
  ).rejects.toMatchObject({ status: 400 });
});
test("directory failures fail closed; revocation stays effective despite cleanup failure", async () => {
  const f = fixture();
  f.db.prepare.mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  await expect(
    createSharedMemory(f.env, "owner", "team", {
      memoryId: "memory",
      requestId: "intent",
    }),
  ).rejects.toThrow();
  await expect(
    revokeSharedMemory(f.env, "owner", "team", "share"),
  ).rejects.toThrow();
  expect(await f.graph.readMemoryShare()).toBeUndefined();
});

test("shared search ranks only authorized page entries by matching term frequency", async () => {
  const f = fixture();
  const rows = ["low", "high", "hidden"].map((id) => ({
    share_id: id,
    memory_id: id,
    workspace_id: "team",
    owner_user_id: "owner",
    created_at: 1,
  }));
  f.db.prepare.mockImplementation(() => ({
    bind: vi.fn(() => ({
      first: async () => rows[0],
      all: async () => ({ results: rows }),
      run: async () => ({ success: true, meta: { changes: 1 } }),
    })),
  }));
  f.graph.readMemoryShare.mockImplementation(async (shareId) =>
    shareId === "hidden"
      ? undefined
      : {
          ...f.projection,
          shareId: shareId ?? "",
          memoryId: shareId ?? "",
          tags: [],
          content: shareId === "high" ? "launch launch plan" : "launch plan",
        },
  );
  const result = await listSharedMemories(f.env, "reader", "team", {
    q: "launch",
    limit: 2,
  });
  expect(result.items.map((item) => item.shareId)).toEqual(["high", "low"]);
  expect(result.nextCursor).toBeTruthy();
});
