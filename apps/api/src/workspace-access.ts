import type { Env } from "./env";

export type WorkspaceRole = "owner" | "admin" | "member";
export type WorkspaceAccess = {
  workspaceId: string;
  ownerUserId: string;
  memberId: string;
  role: WorkspaceRole;
};
export class WorkspaceAccessError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 415 | 503,
    public error: string,
  ) {
    super(error);
  }
}
function primary(env: Env) {
  if (!env.AUTH_DB) throw new WorkspaceAccessError(503, "auth_db_unavailable");
  return env.AUTH_DB;
}
const accessQuery = `SELECT w.id AS workspaceId,w.owner_user_id AS ownerUserId,m.id AS memberId,
 CASE WHEN w.owner_user_id=m.user_id THEN 'owner' ELSE m.role END AS role
 FROM workspace w JOIN user owner ON owner.id=w.owner_user_id JOIN workspace_member m ON m.workspace_id=w.id JOIN user u ON u.id=m.user_id
 WHERE m.user_id=? AND w.id=? AND m.status='active' AND m.accepted_at IS NOT NULL
 AND (m.user_id=w.owner_user_id OR m.role IN ('admin','member'))`;
export async function getWorkspaceAccess(
  env: Env,
  actorId: string,
  workspaceId: string,
): Promise<WorkspaceAccess | undefined> {
  return (
    (await primary(env)
      .prepare(accessQuery)
      .bind(actorId, workspaceId)
      .first<WorkspaceAccess>()) ?? undefined
  );
}
async function requireAccess(env: Env, actorId: string, workspaceId: string) {
  const access = await getWorkspaceAccess(env, actorId, workspaceId);
  if (!access) throw new WorkspaceAccessError(404, "not_found");
  return access;
}
// Repeated inside mutation statements: preflight reads alone cannot authorize a write.
const authority = `EXISTS(SELECT 1 FROM workspace w JOIN user owner ON owner.id=w.owner_user_id JOIN workspace_member a ON a.workspace_id=w.id JOIN user au ON au.id=a.user_id
 WHERE w.id=? AND a.user_id=? AND a.id=? AND a.status='active' AND a.accepted_at IS NOT NULL
 AND (w.owner_user_id=a.user_id OR (a.role='admin' AND ?='member')))`;
function requireRole(role: string): asserts role is "admin" | "member" {
  if (role !== "admin" && role !== "member")
    throw new WorkspaceAccessError(400, "invalid_role");
}
export function assertWorkspaceRequestOrigin(env: Env, request: Request) {
  const url = new URL(request.url);
  const allowed = new Set([url.origin]);
  if (env.OPENMEMORY_BASE_URL)
    allowed.add(new URL(env.OPENMEMORY_BASE_URL).origin);
  if (env.BETTER_AUTH_URL) allowed.add(new URL(env.BETTER_AUTH_URL).origin);
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    allowed.add("http://127.0.0.1:54152");
    allowed.add("http://localhost:54152");
  }
  const origin = request.headers.get("origin");
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (origin !== null && !allowed.has(origin))
  )
    throw new WorkspaceAccessError(403, "invalid_origin");
  if (
    ["POST", "PATCH"].includes(request.method) &&
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json"
  )
    throw new WorkspaceAccessError(415, "json_required");
}
export async function listWorkspaces(env: Env, actorId: string) {
  const result = await primary(env)
    .prepare(`SELECT w.id,w.name,w.owner_user_id AS ownerUserId,m.id AS memberId,
 CASE WHEN w.owner_user_id=m.user_id THEN 'owner' ELSE m.role END AS role
 FROM workspace w JOIN user owner ON owner.id=w.owner_user_id JOIN workspace_member m ON m.workspace_id=w.id JOIN user u ON u.id=m.user_id
 WHERE m.user_id=? AND m.status='active' AND m.accepted_at IS NOT NULL AND (m.user_id=w.owner_user_id OR m.role IN ('admin','member')) ORDER BY w.id`)
    .bind(actorId)
    .all<{
      id: string;
      name: string;
      ownerUserId: string;
      memberId: string;
      role: WorkspaceRole;
    }>();
  return result.results;
}
export async function listWorkspaceMembers(
  env: Env,
  actorId: string,
  workspaceId: string,
) {
  const access = await requireAccess(env, actorId, workspaceId);
  const result = await primary(env)
    .prepare(
      `SELECT m.id,m.user_id AS userId,m.email,m.role,m.status,m.accepted_at AS acceptedAt,u.name FROM workspace_member m LEFT JOIN user u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.id`,
    )
    .bind(workspaceId)
    .all<{
      id: string;
      userId: string | null;
      email?: string;
      role: WorkspaceRole;
      status: string;
      acceptedAt: number | null;
      name: string | null;
    }>();
  const current = await requireAccess(env, actorId, workspaceId);
  if (current.memberId !== access.memberId)
    throw new WorkspaceAccessError(404, "not_found");
  return result.results.map(({ email, ...member }) => ({
    ...member,
    ...(current.role !== "member" ? { email } : {}),
  }));
}
async function digest(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export async function createWorkspaceInvitation(
  env: Env,
  actorId: string,
  workspaceId: string,
  input: { email: string; role?: string },
) {
  const role = input.role ?? "member";
  requireRole(role);
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new WorkspaceAccessError(400, "invalid_email");
  const access = await requireAccess(env, actorId, workspaceId);
  if (
    access.role !== "owner" &&
    !(access.role === "admin" && role === "member")
  )
    throw new WorkspaceAccessError(403, "forbidden");
  const db = primary(env);
  const existing = await db
    .prepare(
      "SELECT id FROM workspace_member WHERE workspace_id=? AND lower(email)=? AND accepted_at IS NOT NULL",
    )
    .bind(workspaceId, email)
    .first();
  if (existing) throw new WorkspaceAccessError(409, "already_member");
  const invitationId = crypto.randomUUID();
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
  const hash = await digest(token),
    now = Math.floor(Date.now() / 1000),
    expires = now + 7 * 86400;
  const guards = `${authority} AND NOT EXISTS(SELECT 1 FROM workspace_invitation pending JOIN workspace pw ON pw.id=pending.workspace_id WHERE pending.workspace_id=? AND pending.email=? AND pending.role='admin' AND pw.owner_user_id<>?) AND NOT EXISTS(SELECT 1 FROM workspace_member WHERE workspace_id=? AND lower(email)=? AND accepted_at IS NOT NULL)`;
  const args = [
    workspaceId,
    actorId,
    access.memberId,
    role,
    workspaceId,
    email,
    actorId,
    workspaceId,
    email,
  ];
  const result = await db.batch([
    db
      .prepare(
        `DELETE FROM workspace_invitation WHERE workspace_id=? AND email=? AND accepted_at IS NULL AND ${guards}`,
      )
      .bind(workspaceId, email, ...args),
    db
      .prepare(`INSERT INTO workspace_invitation(id,workspace_id,email,role,token_hash,inviter_user_id,inviter_member_id,target_user_id,expires_at,created_at)
 SELECT ?,?,?,?,?,?,?,(SELECT id FROM user WHERE lower(email)=?),?,? WHERE ${guards} RETURNING id`)
      .bind(
        invitationId,
        workspaceId,
        email,
        role,
        hash,
        actorId,
        access.memberId,
        email,
        expires,
        now,
        ...args,
      ),
  ]);
  if (!result[1].results.length)
    throw new WorkspaceAccessError(409, "invitation_conflict");
  return {
    id: invitationId,
    invitationId,
    token,
    expiresAt: new Date(expires * 1000).toISOString(),
    email,
    role,
    status: "invited" as const,
    createdAt: new Date(now * 1000).toISOString(),
    updatedAt: new Date(now * 1000).toISOString(),
  };
}
export async function acceptWorkspaceInvitation(
  env: Env,
  actorId: string,
  invitationId: string,
  token: string,
) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new WorkspaceAccessError(404, "not_found");
  const hash = await digest(token),
    memberId = crypto.randomUUID(),
    now = Math.floor(Date.now() / 1000);
  const row = await primary(env)
    .prepare(`UPDATE workspace_invitation SET accepted_at=?,accepted_user_id=?,accepted_member_id=?
 WHERE id=? AND token_hash=? AND accepted_at IS NULL AND expires_at>?
 AND EXISTS(SELECT 1 FROM user u WHERE u.id=? AND lower(u.email)=workspace_invitation.email AND (target_user_id IS NULL OR target_user_id=u.id))
 AND EXISTS(SELECT 1 FROM workspace w JOIN user owner ON owner.id=w.owner_user_id JOIN workspace_member a ON a.workspace_id=w.id JOIN user au ON au.id=a.user_id
 WHERE w.id=workspace_invitation.workspace_id AND a.id=inviter_member_id AND a.user_id=inviter_user_id AND a.accepted_at IS NOT NULL AND a.status='active'
 AND (w.owner_user_id=a.user_id OR (a.role='admin' AND workspace_invitation.role='member')))
 AND NOT EXISTS(SELECT 1 FROM workspace_member m WHERE m.workspace_id=workspace_invitation.workspace_id AND m.user_id=? AND m.accepted_at IS NOT NULL)
 RETURNING workspace_id AS workspaceId`)
    .bind(now, actorId, memberId, invitationId, hash, now, actorId, actorId)
    .first<{ workspaceId: string }>();
  if (!row) throw new WorkspaceAccessError(404, "not_found");
  const access = await getWorkspaceAccess(env, actorId, row.workspaceId);
  if (!access || access.memberId !== memberId)
    throw new WorkspaceAccessError(409, "membership_changed");
  return access;
}
export async function revokeWorkspaceInvitation(
  env: Env,
  actorId: string,
  workspaceId: string,
  invitationId: string,
) {
  const access = await requireAccess(env, actorId, workspaceId);
  const row = await primary(env)
    .prepare(
      `DELETE FROM workspace_invitation WHERE id=? AND workspace_id=? AND accepted_at IS NULL AND ${authority.replace("?='member'", "workspace_invitation.role='member'")} RETURNING id`,
    )
    .bind(invitationId, workspaceId, workspaceId, actorId, access.memberId)
    .first();
  if (!row) throw new WorkspaceAccessError(404, "not_found");
  return { revoked: true };
}
export async function changeWorkspaceMemberRole(
  env: Env,
  actorId: string,
  workspaceId: string,
  memberId: string,
  role: string,
) {
  requireRole(role);
  const access = await requireAccess(env, actorId, workspaceId);
  if (access.role !== "owner") throw new WorkspaceAccessError(403, "forbidden");
  const row = await primary(env)
    .prepare(`UPDATE workspace_member SET role=?,updated_at=unixepoch() WHERE id=? AND workspace_id=? AND accepted_at IS NOT NULL
 AND user_id<>(SELECT owner_user_id FROM workspace WHERE id=?) AND ${authority}`)
    .bind(
      role,
      memberId,
      workspaceId,
      workspaceId,
      workspaceId,
      actorId,
      access.memberId,
      "admin",
    )
    .run();
  if (!row.meta.changes)
    throw new WorkspaceAccessError(403, "owner_member_required");
  return { updated: true };
}
export async function removeWorkspaceMembership(
  env: Env,
  actorId: string,
  workspaceId: string,
  memberId: string,
) {
  const access = await requireAccess(env, actorId, workspaceId);
  const row = await primary(env)
    .prepare(`DELETE FROM workspace_member WHERE id=? AND workspace_id=?
 AND COALESCE(user_id,'')<>(SELECT owner_user_id FROM workspace WHERE id=?)
 AND (${authority.replace("?='member'", "workspace_member.role='member'")} OR (id=? AND user_id=? AND ${authority.replace("(a.role='admin' AND ?='member')", "a.role IN ('admin','member')")})) RETURNING id`)
    .bind(
      memberId,
      workspaceId,
      workspaceId,
      workspaceId,
      actorId,
      access.memberId,
      access.memberId,
      actorId,
      workspaceId,
      actorId,
      access.memberId,
    )
    .first();
  if (!row) throw new WorkspaceAccessError(403, "owner_member_required");
  return { removed: true };
}
export async function deleteWorkspace(
  env: Env,
  actorId: string,
  workspaceId: string,
  input: { confirmWorkspaceId: string; confirmName: string },
) {
  const access = await requireAccess(env, actorId, workspaceId);
  if (access.role !== "owner") throw new WorkspaceAccessError(403, "forbidden");
  if (input.confirmWorkspaceId !== workspaceId)
    throw new WorkspaceAccessError(409, "workspace_confirmation_mismatch");
  const row = await primary(env)
    .prepare(
      `DELETE FROM workspace WHERE id=? AND name=? AND owner_user_id=? AND ${authority} RETURNING id`,
    )
    .bind(
      workspaceId,
      input.confirmName,
      actorId,
      workspaceId,
      actorId,
      access.memberId,
      "admin",
    )
    .first();
  if (!row)
    throw new WorkspaceAccessError(409, "workspace_confirmation_mismatch");
  return { deleted: true, workspaceId };
}
