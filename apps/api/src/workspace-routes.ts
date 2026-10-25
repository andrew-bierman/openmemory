import { z } from "zod";
import { getAccount } from "./account";
import { resolveOpenMemorySession } from "./better-auth";
import type { Env } from "./env";
import {
  acceptWorkspaceInvitation,
  assertWorkspaceRequestOrigin,
  changeWorkspaceMemberRole,
  createWorkspaceInvitation,
  deleteWorkspace,
  listWorkspaceMembers,
  listWorkspaces,
  removeWorkspaceMembership,
  revokeWorkspaceInvitation,
  WorkspaceAccessError,
} from "./workspace-access";
import {
  createSharedMemory,
  listSharedMemories,
  readSharedMemory,
  revokeSharedMemory,
} from "./workspace-sharing";

const id = z.string().min(1).max(128);
const role = z.enum(["admin", "member"]);
const page = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    cursor: z.string().max(1024).optional(),
  })
  .strict();
export function isWorkspaceRoute(path: string) {
  return /^\/v1\/(workspaces|workspace-invitations)(\/|$)/.test(path);
}
export async function handleWorkspaceRequest(
  env: Env,
  request: Request,
): Promise<Response> {
  try {
    assertWorkspaceRequestOrigin(env, request);
    const session = await resolveOpenMemorySession(env, request);
    if (!session) return respond({ error: "unauthorized" }, 401);
    const actor = session.user.id;
    const url = new URL(request.url),
      method = request.method;
    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
    const workspaceId = parts[2] ? id.parse(parts[2]) : "";
    const resource = parts[3],
      resourceId = parts[4] ? id.parse(parts[4]) : "";
    if (
      parts[1] === "workspace-invitations" &&
      parts.length === 4 &&
      resource === "accept" &&
      method === "POST"
    ) {
      const body = z
        .object({ token: z.string().length(64) })
        .strict()
        .parse(await request.json());
      return respond(
        await acceptWorkspaceInvitation(env, actor, workspaceId, body.token),
      );
    }
    if (parts[1] !== "workspaces") return respond({ error: "not_found" }, 404);
    if (parts.length === 2 && method === "GET") {
      const own = await getAccount(env, request);
      if (own.status !== 200) return respond(own.body, own.status);
      return respond(await listWorkspaces(env, actor));
    }
    if (parts.length === 3 && method === "DELETE") {
      const body = z
        .object({
          confirmWorkspaceId: id,
          confirmName: z.string().min(1).max(120),
        })
        .strict()
        .parse(await request.json());
      return respond(await deleteWorkspace(env, actor, workspaceId, body));
    }
    if (resource === "members") {
      if (parts.length === 4 && method === "GET")
        return respond(await listWorkspaceMembers(env, actor, workspaceId));
      if (parts.length === 5 && method === "DELETE")
        return respond(
          await removeWorkspaceMembership(env, actor, workspaceId, resourceId),
        );
      if (parts.length === 5 && method === "PATCH") {
        const body = z
          .object({ role })
          .strict()
          .parse(await request.json());
        return respond(
          await changeWorkspaceMemberRole(
            env,
            actor,
            workspaceId,
            resourceId,
            body.role,
          ),
        );
      }
    }
    if (resource === "invitations") {
      if (parts.length === 4 && method === "POST") {
        const body = z
          .object({ email: z.string().email().max(254), role: role.optional() })
          .strict()
          .parse(await request.json());
        return respond(
          await createWorkspaceInvitation(env, actor, workspaceId, body),
          201,
        );
      }
      if (parts.length === 5 && method === "DELETE")
        return respond(
          await revokeWorkspaceInvitation(env, actor, workspaceId, resourceId),
        );
    }
    if (resource === "shares") {
      if (parts.length === 4 && method === "POST") {
        const body = z
          .object({ memoryId: id, requestId: id })
          .strict()
          .parse(await request.json());
        return respond(
          await createSharedMemory(env, actor, workspaceId, body),
          201,
        );
      }
      if (parts.length === 4 && method === "GET") {
        const input = page.parse({
          limit: url.searchParams.has("limit")
            ? Number(url.searchParams.get("limit"))
            : undefined,
          cursor: url.searchParams.get("cursor") ?? undefined,
        });
        return respond(
          await listSharedMemories(env, actor, workspaceId, input),
        );
      }
      if (parts.length === 5 && method === "GET") {
        const item = await readSharedMemory(
          env,
          actor,
          workspaceId,
          resourceId,
        );
        return item ? respond(item) : respond({ error: "not_found" }, 404);
      }
      if (parts.length === 5 && method === "DELETE")
        return respond(
          await revokeSharedMemory(env, actor, workspaceId, resourceId),
        );
    }
    if (resource === "search" && parts.length === 4 && method === "POST") {
      const body = page
        .extend({ q: z.string().min(1).max(500) })
        .strict()
        .parse(await request.json());
      return respond(await listSharedMemories(env, actor, workspaceId, body));
    }
    return respond({ error: "not_found" }, 404);
  } catch (error) {
    if (error instanceof WorkspaceAccessError)
      return respond({ error: error.error }, error.status);
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      error instanceof URIError
    )
      return respond({ error: "invalid_request" }, 400);
    if (
      error instanceof Error &&
      [
        "share_unavailable",
        "share_intent_revoked",
        "share_intent_conflict",
        "ingestion_cancelled_by_purge",
        "tenant_deleted",
      ].includes(error.message)
    )
      return respond({ error: "share_unavailable" }, 409);
    return respond({ error: "workspace_unavailable" }, 503);
  }
}
function respond(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    },
  });
}
