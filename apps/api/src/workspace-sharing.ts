import { normalizeTenantId } from "@openmemory/core";
import type { Env } from "./env";
import { getWorkspaceAccess, WorkspaceAccessError } from "./workspace-access";

export type SharedMemory = {
  shareId: string;
  workspaceId: string;
  ownerUserId: string;
  memoryId: string;
  content: string;
  type: string;
  tags: string[];
};
type DirectoryRow = {
  share_id: string;
  workspace_id: string;
  owner_user_id: string;
  memory_id: string;
  created_at: number;
};
type SharedPageInput = { limit?: number; cursor?: string; q?: string };
function database(env: Env) {
  if (!env.AUTH_DB) throw new WorkspaceAccessError(503, "auth_db_unavailable");
  return env.AUTH_DB;
}
async function requireMembership(
  env: Env,
  actorId: string,
  workspaceId: string,
) {
  const access = await getWorkspaceAccess(env, actorId, workspaceId);
  if (!access) throw new WorkspaceAccessError(404, "not_found");
  return access;
}
function ownerGraph(env: Env, ownerId: string) {
  const tenantId = normalizeTenantId(ownerId);
  if (!tenantId) throw new WorkspaceAccessError(404, "not_found");
  return env.MEMORY_GRAPHS.get(env.MEMORY_GRAPHS.idFromName(tenantId));
}

async function authorizeRow(env: Env, actorId: string, row: DirectoryRow) {
  const reader = await getWorkspaceAccess(env, actorId, row.workspace_id);
  const owner = await getWorkspaceAccess(
    env,
    row.owner_user_id,
    row.workspace_id,
  );
  if (!reader || !owner) return undefined;
  const graph = ownerGraph(env, row.owner_user_id);
  const grant = await graph.readMemoryShare(row.share_id, row.workspace_id);
  if (
    !grant ||
    grant.ownerMembershipId !== owner.memberId ||
    grant.memoryId !== row.memory_id
  )
    return undefined;
  const currentReader = await getWorkspaceAccess(
    env,
    actorId,
    row.workspace_id,
  );
  const currentOwner = await getWorkspaceAccess(
    env,
    row.owner_user_id,
    row.workspace_id,
  );
  if (
    currentReader?.memberId !== reader.memberId ||
    currentOwner?.memberId !== owner.memberId
  )
    return undefined;
  const current = await graph.readMemoryShare(row.share_id, row.workspace_id);
  if (
    !current ||
    current.ownerMembershipId !== owner.memberId ||
    current.generation !== grant.generation ||
    current.memoryId !== row.memory_id
  )
    return undefined;
  return {
    shareId: current.shareId,
    workspaceId: current.workspaceId,
    ownerUserId: row.owner_user_id,
    memoryId: current.memoryId,
    content: current.content,
    type: current.type,
    tags: current.tags,
  } satisfies SharedMemory;
}

export async function createSharedMemory(
  env: Env,
  actorId: string,
  workspaceId: string,
  input: { memoryId: string; requestId: string },
) {
  const graph = ownerGraph(env, actorId);
  const generation = await graph.getIngestionGeneration();
  const access = await requireMembership(env, actorId, workspaceId);
  const grant = await graph.createMemoryShare({
    ...input,
    workspaceId,
    ownerMembershipId: access.memberId,
    generation,
  });
  const current = await requireMembership(env, actorId, workspaceId);
  if (current.memberId !== access.memberId)
    throw new WorkspaceAccessError(409, "membership_changed");
  await database(env)
    .prepare(`INSERT INTO workspace_share_directory(share_id,owner_user_id,workspace_id,memory_id,created_at)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_member WHERE id=? AND workspace_id=? AND user_id=? AND status='active' AND accepted_at IS NOT NULL)
    ON CONFLICT(share_id) DO NOTHING`)
    .bind(
      grant.shareId,
      actorId,
      workspaceId,
      grant.memoryId,
      Math.floor(Date.now() / 1000),
      access.memberId,
      workspaceId,
      actorId,
    )
    .run();
  const item = await readSharedMemory(env, actorId, workspaceId, grant.shareId);
  if (!item) throw new WorkspaceAccessError(409, "share_unavailable");
  return item;
}

export async function revokeSharedMemory(
  env: Env,
  actorId: string,
  workspaceId: string,
  shareId: string,
) {
  await ownerGraph(env, actorId).revokeMemoryShare(shareId, workspaceId);
  await database(env)
    .prepare(
      "DELETE FROM workspace_share_directory WHERE share_id=? AND workspace_id=? AND owner_user_id=?",
    )
    .bind(shareId, workspaceId, actorId)
    .run();
  return { revoked: true };
}

export async function readSharedMemory(
  env: Env,
  actorId: string,
  workspaceId: string,
  shareId: string,
) {
  await requireMembership(env, actorId, workspaceId);
  const row = await database(env)
    .prepare(
      "SELECT share_id,owner_user_id,workspace_id,memory_id,created_at FROM workspace_share_directory WHERE workspace_id=? AND share_id=?",
    )
    .bind(workspaceId, shareId)
    .first<DirectoryRow>();
  return row ? authorizeRow(env, actorId, row) : undefined;
}

export async function listSharedMemories(
  env: Env,
  actorId: string,
  workspaceId: string,
  input: SharedPageInput,
) {
  const access = await requireMembership(env, actorId, workspaceId);
  const limit = input.limit ?? 25;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 25 ||
    (input.q !== undefined &&
      (typeof input.q !== "string" || input.q.length > 500))
  )
    throw new WorkspaceAccessError(400, "invalid_shared_query");
  let after = 0,
    afterId = "";
  if (input.cursor) {
    try {
      if (input.cursor.length > 1024) throw new Error();
      const tuple: unknown = JSON.parse(atob(input.cursor));
      if (
        !Array.isArray(tuple) ||
        tuple.length !== 3 ||
        tuple[0] !== workspaceId ||
        !Number.isSafeInteger(tuple[1]) ||
        tuple[1] < 0 ||
        typeof tuple[2] !== "string" ||
        tuple[2].length > 128
      )
        throw new Error();
      [, after, afterId] = tuple;
    } catch {
      throw new WorkspaceAccessError(400, "invalid_shared_cursor");
    }
  }
  const rows = (
    await database(env)
      .prepare(`SELECT share_id,owner_user_id,workspace_id,memory_id,created_at FROM workspace_share_directory
    WHERE workspace_id=? AND (created_at>? OR (created_at=? AND share_id>?)) ORDER BY created_at,share_id LIMIT 101`)
      .bind(workspaceId, after, after, afterId)
      .all<DirectoryRow>()
  ).results;
  const candidates: DirectoryRow[] = [];
  const terms = (input.q ?? "")
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  let processed = 0;
  for (const row of rows.slice(0, 100)) {
    processed++;
    const item = await authorizeRow(env, actorId, row);
    if (item && matches(item, terms)) candidates.push(row);
    if (candidates.length >= limit) break;
  }
  // Earlier page entries may have been revoked while later entries were loading.
  const fresh: SharedMemory[] = [];
  for (const row of candidates) {
    const item = await authorizeRow(env, actorId, row);
    if (item && matches(item, terms)) fresh.push(item);
  }
  const current = await requireMembership(env, actorId, workspaceId);
  if (current.memberId !== access.memberId)
    throw new WorkspaceAccessError(404, "not_found");
  const last = rows[processed - 1];
  const nextCursor =
    last && processed < rows.length
      ? btoa(JSON.stringify([workspaceId, last.created_at, last.share_id]))
      : undefined;
  if (terms.length)
    fresh.sort((a, b) => lexicalScore(b, terms) - lexicalScore(a, terms));
  return { items: fresh, nextCursor, ranking: "page-local" as const };
}
function matches(item: SharedMemory, terms: string[]) {
  const text = `${item.content} ${item.tags.join(" ")}`.toLocaleLowerCase();
  return terms.every((term) => text.includes(term));
}

function lexicalScore(item: SharedMemory, terms: string[]) {
  const text = `${item.content} ${item.tags.join(" ")}`.toLocaleLowerCase();
  return terms.reduce((score, term) => score + text.split(term).length - 1, 0);
}
