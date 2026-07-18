import { normalizeTenantId } from "@openmemory/core";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { resolveOpenMemorySession } from "./better-auth";
import {
  authAccount,
  authSession,
  authUser,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  workspace,
  workspaceMember,
} from "./db/schema";
import type { Env } from "./env";

type AccountResult =
  | { status: 200; body: AccountResponse }
  | { status: 200; body: AccountDeletionResult }
  | { status: 201; body: WorkspaceMemberResponse }
  | { status: 401; body: { error: "unauthorized" } }
  | { status: 409; body: { error: "account_confirmation_mismatch" } }
  | { status: 403; body: { error: "owner_member_required" } }
  | { status: 404; body: { error: "not_found" } }
  | { status: 503; body: { error: "auth_db_unavailable" } };

type AccountContext =
  | {
      ok: true;
      db: ReturnType<typeof drizzle>;
      user: NonNullable<
        Awaited<ReturnType<typeof resolveOpenMemorySession>>
      >["user"];
      workspace: typeof workspace.$inferSelect;
    }
  | {
      ok: false;
      result:
        | { status: 401; body: { error: "unauthorized" } }
        | { status: 503; body: { error: "auth_db_unavailable" } };
    };

export type AccountResponse = {
  user: {
    id: string;
    email: string;
    name: string;
  };
  workspace: {
    id: string;
    name: string;
    tenantId: string;
    ownerUserId: string;
    createdAt: string;
    updatedAt: string;
  };
  members: WorkspaceMemberResponse[];
};

export type WorkspaceMemberResponse = {
  id: string;
  email: string;
  role: "owner" | "admin" | "member";
  status: "active" | "invited";
  userId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AccountDeletionResult = {
  userId: string;
  email: string;
  tenantId: string;
  controlPlane: {
    oauthAccessTokensDeleted: number;
    oauthRefreshTokensDeleted: number;
    oauthConsentsDeleted: number;
    oauthClientsDeleted: number;
    sessionsDeleted: number;
    authAccountsDeleted: number;
    ownedWorkspacesDeleted: number;
    workspaceMembershipsDeleted: number;
    userDeleted: boolean;
  };
  deletedAt: string;
};

export async function getAccount(env: Env, request: Request) {
  const context = await getAccountContext(env, request);
  if (!context.ok) {
    return context.result;
  }

  return {
    status: 200,
    body: await readAccount(context),
  } satisfies AccountResult;
}

export async function renameWorkspace(
  env: Env,
  request: Request,
  input: { name: string },
) {
  const context = await getAccountContext(env, request);
  if (!context.ok) {
    return context.result;
  }

  const name = normalizeWorkspaceName(input.name);
  const now = new Date();
  const [renamedWorkspace] = await context.db
    .update(workspace)
    .set({ name, updatedAt: now })
    .where(eq(workspace.id, context.workspace.id))
    .returning();

  return {
    status: 200,
    body: await readAccount({
      ...context,
      workspace: renamedWorkspace ?? context.workspace,
    }),
  } satisfies AccountResult;
}

export async function updateAccountProfile(
  env: Env,
  request: Request,
  input: { name: string },
) {
  const context = await getAccountContext(env, request);
  if (!context.ok) {
    return context.result;
  }

  const name = normalizeDisplayName(input.name);
  const now = new Date();
  const [updatedUser] = await context.db
    .update(authUser)
    .set({ name, updatedAt: now })
    .where(eq(authUser.id, context.user.id))
    .returning();

  return {
    status: 200,
    body: await readAccount({
      ...context,
      user: {
        ...context.user,
        name: updatedUser?.name ?? name,
      },
    }),
  } satisfies AccountResult;
}

export async function inviteWorkspaceMember(
  env: Env,
  request: Request,
  input: { email: string; role?: string },
) {
  const context = await getAccountContext(env, request);
  if (!context.ok) {
    return context.result;
  }

  const email = normalizeEmail(input.email);
  const role = input.role === "admin" ? "admin" : "member";
  const now = new Date();
  const [existingUser] = await context.db
    .select({ id: authUser.id })
    .from(authUser)
    .where(eq(authUser.email, email))
    .limit(1);
  const [existingMember] = await context.db
    .select()
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, context.workspace.id),
        eq(workspaceMember.email, email),
      ),
    )
    .limit(1);

  if (existingMember) {
    const [updated] = await context.db
      .update(workspaceMember)
      .set({
        role,
        status: existingUser ? "active" : "invited",
        userId: existingUser?.id,
        updatedAt: now,
      })
      .where(eq(workspaceMember.id, existingMember.id))
      .returning();
    return {
      status: 201,
      body: serializeMember(updated),
    } satisfies AccountResult;
  }

  const [created] = await context.db
    .insert(workspaceMember)
    .values({
      id: crypto.randomUUID(),
      workspaceId: context.workspace.id,
      userId: existingUser?.id,
      email,
      role,
      status: existingUser ? "active" : "invited",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return {
    status: 201,
    body: serializeMember(created),
  } satisfies AccountResult;
}

export async function removeWorkspaceMember(
  env: Env,
  request: Request,
  memberId: string,
) {
  const context = await getAccountContext(env, request);
  if (!context.ok) {
    return context.result;
  }

  const [member] = await context.db
    .select()
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.id, memberId),
        eq(workspaceMember.workspaceId, context.workspace.id),
      ),
    )
    .limit(1);
  if (!member) {
    return {
      status: 404,
      body: { error: "not_found" },
    } satisfies AccountResult;
  }
  if (member.role === "owner") {
    return {
      status: 403,
      body: { error: "owner_member_required" },
    } satisfies AccountResult;
  }

  await context.db
    .delete(workspaceMember)
    .where(eq(workspaceMember.id, memberId));

  return {
    status: 200,
    body: await readAccount(context),
  } satisfies AccountResult;
}

export async function deleteAccountControlPlane(
  env: Env,
  request: Request,
  input: { confirmEmail: string; confirmTenantId: string; tenantId: string },
) {
  const context = await getAccountContext(env, request);
  if (!context.ok) {
    return context.result;
  }

  if (
    normalizeEmail(input.confirmEmail) !== normalizeEmail(context.user.email) ||
    normalizeTenantId(input.confirmTenantId) !== input.tenantId
  ) {
    return {
      status: 409,
      body: { error: "account_confirmation_mismatch" as const },
    } satisfies AccountResult;
  }

  const deletedAt = new Date().toISOString();
  const ownedWorkspaceRows = await context.db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.ownerUserId, context.user.id));

  const oauthAccessTokensDeleted = (
    await context.db
      .delete(oauthAccessToken)
      .where(eq(oauthAccessToken.userId, context.user.id))
      .returning({ id: oauthAccessToken.id })
  ).length;
  const oauthRefreshTokensDeleted = (
    await context.db
      .delete(oauthRefreshToken)
      .where(eq(oauthRefreshToken.userId, context.user.id))
      .returning({ id: oauthRefreshToken.id })
  ).length;
  const oauthConsentsDeleted = (
    await context.db
      .delete(oauthConsent)
      .where(eq(oauthConsent.userId, context.user.id))
      .returning({ id: oauthConsent.id })
  ).length;
  const oauthClientsDeleted = (
    await context.db
      .delete(oauthClient)
      .where(eq(oauthClient.userId, context.user.id))
      .returning({ id: oauthClient.id })
  ).length;
  const sessionsDeleted = (
    await context.db
      .delete(authSession)
      .where(eq(authSession.userId, context.user.id))
      .returning({ id: authSession.id })
  ).length;
  const authAccountsDeleted = (
    await context.db
      .delete(authAccount)
      .where(eq(authAccount.userId, context.user.id))
      .returning({ id: authAccount.id })
  ).length;
  let workspaceMembershipsDeleted = (
    await context.db
      .delete(workspaceMember)
      .where(eq(workspaceMember.userId, context.user.id))
      .returning({ id: workspaceMember.id })
  ).length;
  for (const ownedWorkspace of ownedWorkspaceRows) {
    workspaceMembershipsDeleted += (
      await context.db
        .delete(workspaceMember)
        .where(eq(workspaceMember.workspaceId, ownedWorkspace.id))
        .returning({ id: workspaceMember.id })
    ).length;
  }
  const ownedWorkspacesDeleted = (
    await context.db
      .delete(workspace)
      .where(eq(workspace.ownerUserId, context.user.id))
      .returning({ id: workspace.id })
  ).length;
  const userDeleted =
    (
      await context.db
        .delete(authUser)
        .where(eq(authUser.id, context.user.id))
        .returning({ id: authUser.id })
    ).length === 1;

  return {
    status: 200,
    body: {
      userId: context.user.id,
      email: context.user.email,
      tenantId: input.tenantId,
      controlPlane: {
        oauthAccessTokensDeleted,
        oauthRefreshTokensDeleted,
        oauthConsentsDeleted,
        oauthClientsDeleted,
        sessionsDeleted,
        authAccountsDeleted,
        ownedWorkspacesDeleted: Math.max(
          ownedWorkspacesDeleted,
          ownedWorkspaceRows.length,
        ),
        workspaceMembershipsDeleted,
        userDeleted,
      },
      deletedAt,
    },
  } satisfies AccountResult;
}

async function getAccountContext(
  env: Env,
  request: Request,
): Promise<AccountContext> {
  const session = await resolveOpenMemorySession(env, request);
  if (!session) {
    return {
      ok: false,
      result: { status: 401, body: { error: "unauthorized" } },
    };
  }
  if (!env.AUTH_DB) {
    return {
      ok: false,
      result: { status: 503, body: { error: "auth_db_unavailable" } },
    };
  }

  const db = drizzle(env.AUTH_DB);
  const accountWorkspace = await ensureWorkspace(db, {
    email: session.user.email,
    name: session.user.name,
    userId: session.user.id,
  });

  return {
    ok: true,
    db,
    user: session.user,
    workspace: accountWorkspace,
  };
}

async function ensureWorkspace(
  db: ReturnType<typeof drizzle>,
  user: { email: string; name: string; userId: string },
) {
  const [existing] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.ownerUserId, user.userId))
    .limit(1);

  if (existing) {
    await ensureOwnerMember(db, existing.id, user);
    return existing;
  }

  const now = new Date();
  const [created] = await db
    .insert(workspace)
    .values({
      id: crypto.randomUUID(),
      ownerUserId: user.userId,
      name: `${user.name || user.email}'s workspace`,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await ensureOwnerMember(db, created.id, user);
  return created;
}

async function ensureOwnerMember(
  db: ReturnType<typeof drizzle>,
  workspaceId: string,
  user: { email: string; name: string; userId: string },
) {
  const email = normalizeEmail(user.email);
  const now = new Date();
  const [existing] = await db
    .select()
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.email, email),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(workspaceMember)
      .set({
        role: "owner",
        status: "active",
        userId: user.userId,
        updatedAt: now,
      })
      .where(eq(workspaceMember.id, existing.id));
    return;
  }

  await db.insert(workspaceMember).values({
    id: crypto.randomUUID(),
    workspaceId,
    userId: user.userId,
    email,
    role: "owner",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

async function readAccount(context: Extract<AccountContext, { ok: true }>) {
  const members = await context.db
    .select()
    .from(workspaceMember)
    .where(eq(workspaceMember.workspaceId, context.workspace.id));

  return {
    user: {
      id: context.user.id,
      email: context.user.email,
      name: context.user.name,
    },
    workspace: {
      id: context.workspace.id,
      name: context.workspace.name,
      tenantId: normalizeTenantId(context.user.id) ?? context.user.id,
      ownerUserId: context.workspace.ownerUserId,
      createdAt: toIso(context.workspace.createdAt),
      updatedAt: toIso(context.workspace.updatedAt),
    },
    members: members
      .map(serializeMember)
      .sort((left, right) => roleRank(left.role) - roleRank(right.role)),
  };
}

function serializeMember(
  member: typeof workspaceMember.$inferSelect,
): WorkspaceMemberResponse {
  return {
    id: member.id,
    email: member.email,
    role: member.role as WorkspaceMemberResponse["role"],
    status: member.status as WorkspaceMemberResponse["status"],
    ...(member.userId ? { userId: member.userId } : {}),
    createdAt: toIso(member.createdAt),
    updatedAt: toIso(member.updatedAt),
  };
}

function roleRank(role: string) {
  return role === "owner" ? 0 : role === "admin" ? 1 : 2;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeWorkspaceName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function normalizeDisplayName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function toIso(value: Date | number | string) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number") {
    return new Date(
      value < 10_000_000_000 ? value * 1000 : value,
    ).toISOString();
  }
  return new Date(value).toISOString();
}
