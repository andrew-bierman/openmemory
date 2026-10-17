import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";

function database(migrate = true) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of [
    "0000_overconfident_sue_storm",
    "0001_oauth_provider_columns",
    "0002_jwks",
    "0003_workspaces",
    "0004_oauth_consent_lookup",
    "0005_oauth_grant_version",
  ])
    db.exec(
      readFileSync(new URL(`../drizzle/${name}.sql`, import.meta.url), "utf8"),
    );
  for (const id of ["owner", "admin", "member", "other"])
    db.prepare(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,0,1,1)",
    ).run(id, id, `${id}@example.com`);
  db.exec(
    "INSERT INTO workspace VALUES('team','owner','Team',1,1); INSERT INTO workspace_member VALUES('owner-instance','team','owner','owner@example.com','owner','active',1,1); INSERT INTO workspace_member VALUES('legacy-instance','team','member','member@example.com','member','active',1,1)",
  );
  const migration = new URL(
    "../drizzle/0006_team_accounts.sql",
    import.meta.url,
  );
  if (migrate && existsSync(migration))
    db.exec(readFileSync(migration, "utf8"));
  return db;
}

describe("accepted workspace membership", () => {
  test("duplicate legacy owner rows converge without losing users or private data", () => {
    const db = database(false);
    db.exec(
      "INSERT INTO workspace_member VALUES('duplicate-owner','team','owner','old-owner@example.com','owner','active',1,1)",
    );
    db.exec(
      readFileSync(
        new URL("../drizzle/0006_team_accounts.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM workspace_member WHERE user_id='owner' AND accepted_at IS NOT NULL",
        )
        .get()?.n,
    ).toBe(1);
    expect(
      db.prepare("SELECT id FROM workspace_member WHERE user_id='owner'").get()
        ?.id,
    ).toBe("duplicate-owner");
    expect(db.prepare("SELECT count(*) AS n FROM user").get()?.n).toBe(4);
    db.close();
  });
  test("migration removes implicit legacy activation without changing users", () => {
    const db = database();
    expect(
      db
        .prepare(
          "SELECT status FROM workspace_member WHERE id='legacy-instance'",
        )
        .get()?.status,
    ).toBe("invited");
    expect(db.prepare("SELECT count(*) AS count FROM user").get()?.count).toBe(
      4,
    );
    db.close();
  });
});

import type { Env } from "../src/env";
import {
  acceptWorkspaceInvitation,
  assertWorkspaceRequestOrigin,
  changeWorkspaceMemberRole,
  createWorkspaceInvitation,
  deleteWorkspace,
  getWorkspaceAccess,
  listWorkspaceMembers,
  listWorkspaces,
  removeWorkspaceMembership,
  revokeWorkspaceInvitation,
} from "../src/workspace-access";

function fixture() {
  const sqlite = database();
  function prepare(sql: string) {
    let args: (string | number | null)[] = [];
    const statement = {
      bind(...values: (string | number | null)[]) {
        args = values;
        return statement;
      },
      async first() {
        return sqlite.prepare(sql).get(...args) ?? null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...args) };
      },
      async run() {
        const result = sqlite.prepare(sql).run(...args);
        return { meta: { changes: Number(result.changes) }, results: [] };
      },
      sql,
      values: () => args,
    };
    return statement;
  }
  const binding = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => ({
          results: sqlite.prepare(s.sql).all(...s.values()),
        }));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, env: { AUTH_DB: binding } as unknown as Env };
}
async function join(
  env: Env,
  userId: string,
  role = "member",
  inviter = "owner",
) {
  const invite = await createWorkspaceInvitation(env, inviter, "team", {
    email: `${userId}@example.com`,
    role,
  });
  return acceptWorkspaceInvitation(
    env,
    userId,
    invite.invitationId,
    invite.token,
  );
}

describe("workspace invitation authority on actual SQLite", () => {
  test("only accepted memberships authorize; explicit acceptance is one-use and secret stays hashed", async () => {
    const { env, sqlite } = fixture();
    expect(await getWorkspaceAccess(env, "owner", "team")).toMatchObject({
      role: "owner",
      memberId: "owner-instance",
    });
    expect(await getWorkspaceAccess(env, "member", "team")).toBeUndefined();
    const invite = await createWorkspaceInvitation(env, "owner", "team", {
      email: "member@example.com",
    });
    expect(await getWorkspaceAccess(env, "member", "team")).toBeUndefined();
    await expect(
      acceptWorkspaceInvitation(env, "member", invite.id, "0".repeat(64)),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      acceptWorkspaceInvitation(env, "other", invite.id, invite.token),
    ).rejects.toMatchObject({ status: 404 });
    const accepted = await acceptWorkspaceInvitation(
      env,
      "member",
      invite.id,
      invite.token,
    );
    expect(accepted.memberId).not.toBe("legacy-instance");
    expect(accepted.memberId).not.toBe(invite.id);
    await expect(
      acceptWorkspaceInvitation(env, "member", invite.id, invite.token),
    ).rejects.toMatchObject({ status: 404 });
    const stored = JSON.stringify(
      sqlite.prepare("SELECT * FROM workspace_invitation").all(),
    );
    expect(stored).not.toContain(invite.token);
    expect(
      JSON.stringify(sqlite.prepare("SELECT * FROM workspace_audit").all()),
    ).not.toContain(invite.token);
    expect(await listWorkspaces(env, "member")).toHaveLength(1);
    expect(
      (await listWorkspaceMembers(env, "member", "team")).every(
        (row) => !("email" in row),
      ),
    ).toBe(true);
    expect(
      (await listWorkspaceMembers(env, "owner", "team")).some(
        (row) => row.email === "member@example.com",
      ),
    ).toBe(true);
    sqlite.close();
  });
  test("expiry, prebound ID mismatch and reissued capability fail closed", async () => {
    const { env, sqlite } = fixture();
    const first = await createWorkspaceInvitation(env, "owner", "team", {
      email: "member@example.com",
    });
    const second = await createWorkspaceInvitation(env, "owner", "team", {
      email: "member@example.com",
    });
    await expect(
      acceptWorkspaceInvitation(env, "member", first.id, first.token),
    ).rejects.toMatchObject({ status: 404 });
    sqlite
      .prepare(
        "UPDATE workspace_invitation SET target_user_id='other' WHERE id=?",
      )
      .run(second.id);
    await expect(
      acceptWorkspaceInvitation(env, "member", second.id, second.token),
    ).rejects.toMatchObject({ status: 404 });
    sqlite
      .prepare(
        "UPDATE workspace_invitation SET target_user_id='member',expires_at=1 WHERE id=?",
      )
      .run(second.id);
    await expect(
      acceptWorkspaceInvitation(env, "member", second.id, second.token),
    ).rejects.toMatchObject({ status: 404 });
    sqlite.close();
  });
  test("owner/admin/member hierarchy and leave preserve owner and membership identity", async () => {
    const { env, sqlite } = fixture();
    const admin = await join(env, "admin", "admin"),
      member = await join(env, "member");
    await expect(
      createWorkspaceInvitation(env, "owner", "team", {
        email: "owner@example.com",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      createWorkspaceInvitation(env, "owner", "team", {
        email: "member@example.com",
        role: "admin",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      createWorkspaceInvitation(env, "member", "team", {
        email: "other@example.com",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createWorkspaceInvitation(env, "admin", "team", {
        email: "other@example.com",
        role: "admin",
      }),
    ).rejects.toMatchObject({ status: 403 });
    const ownerInvite = await createWorkspaceInvitation(env, "owner", "team", {
      email: "other@example.com",
      role: "admin",
    });
    await expect(
      createWorkspaceInvitation(env, "admin", "team", {
        email: "other@example.com",
        role: "member",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      revokeWorkspaceInvitation(env, "admin", "team", ownerInvite.id),
    ).rejects.toMatchObject({ status: 404 });
    await revokeWorkspaceInvitation(env, "owner", "team", ownerInvite.id);
    await expect(
      changeWorkspaceMemberRole(env, "admin", "team", member.memberId, "admin"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      changeWorkspaceMemberRole(
        env,
        "owner",
        "team",
        "owner-instance",
        "member",
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      removeWorkspaceMembership(env, "owner", "team", "owner-instance"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      removeWorkspaceMembership(env, "member", "team", admin.memberId),
    ).rejects.toMatchObject({ status: 403 });
    await changeWorkspaceMemberRole(
      env,
      "owner",
      "team",
      member.memberId,
      "admin",
    );
    expect(await getWorkspaceAccess(env, "member", "team")).toMatchObject({
      role: "admin",
      memberId: member.memberId,
    });
    await expect(
      removeWorkspaceMembership(env, "admin", "team", member.memberId),
    ).rejects.toMatchObject({ status: 403 });
    await changeWorkspaceMemberRole(
      env,
      "owner",
      "team",
      member.memberId,
      "member",
    );
    await removeWorkspaceMembership(env, "admin", "team", member.memberId);
    expect(await getWorkspaceAccess(env, "member", "team")).toBeUndefined();
    const fresh = await join(env, "member");
    expect(fresh.memberId).not.toBe(member.memberId);
    await removeWorkspaceMembership(env, "member", "team", fresh.memberId);
    expect(await getWorkspaceAccess(env, "member", "team")).toBeUndefined();
    sqlite.close();
  });
  test("inviter demotion or removal/rejoin cannot revive pending invitations", async () => {
    const { env, sqlite } = fixture();
    const admin = await join(env, "admin", "admin");
    const invite = await createWorkspaceInvitation(env, "admin", "team", {
      email: "other@example.com",
    });
    await changeWorkspaceMemberRole(
      env,
      "owner",
      "team",
      admin.memberId,
      "member",
    );
    await expect(
      acceptWorkspaceInvitation(env, "other", invite.id, invite.token),
    ).rejects.toMatchObject({ status: 404 });
    await removeWorkspaceMembership(env, "owner", "team", admin.memberId);
    await join(env, "admin", "admin");
    await expect(
      acceptWorkspaceInvitation(env, "other", invite.id, invite.token),
    ).rejects.toMatchObject({ status: 404 });
    sqlite.close();
  });
  test("simultaneous accepts yield one new membership; acknowledged revoke prevents acceptance", async () => {
    const { env, sqlite } = fixture();
    const invite = await createWorkspaceInvitation(env, "owner", "team", {
      email: "member@example.com",
    });
    const results = await Promise.allSettled([
      acceptWorkspaceInvitation(env, "member", invite.id, invite.token),
      acceptWorkspaceInvitation(env, "member", invite.id, invite.token),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS n FROM workspace_member WHERE user_id='member' AND accepted_at IS NOT NULL",
        )
        .get()?.n,
    ).toBe(1);
    const revoked = await createWorkspaceInvitation(env, "owner", "team", {
      email: "other@example.com",
    });
    await revokeWorkspaceInvitation(env, "owner", "team", revoked.id);
    await expect(
      acceptWorkspaceInvitation(env, "other", revoked.id, revoked.token),
    ).rejects.toMatchObject({ status: 404 });
    sqlite.close();
  });
  test("workspace deletion requires owner confirmation and retains every user", async () => {
    const { env, sqlite } = fixture();
    await join(env, "member");
    sqlite.exec(
      "INSERT INTO workspace_share_directory VALUES('share','member','team','memory',1)",
    );
    await expect(
      deleteWorkspace(env, "member", "team", {
        confirmWorkspaceId: "team",
        confirmName: "Team",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      deleteWorkspace(env, "owner", "team", {
        confirmWorkspaceId: "team",
        confirmName: "Wrong",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await deleteWorkspace(env, "owner", "team", {
      confirmWorkspaceId: "team",
      confirmName: "Team",
    });
    expect(await getWorkspaceAccess(env, "owner", "team")).toBeUndefined();
    expect(sqlite.prepare("SELECT count(*) AS n FROM user").get()?.n).toBe(4);
    expect(
      sqlite
        .prepare("SELECT count(*) AS n FROM workspace_share_directory")
        .get()?.n,
    ).toBe(0);
    sqlite.close();
  });
  test("missing database and database failure never become authorized or empty success", async () => {
    await expect(
      getWorkspaceAccess({} as Env, "owner", "team"),
    ).rejects.toMatchObject({ status: 503 });
    const { env, sqlite } = fixture();
    sqlite.close();
    await expect(getWorkspaceAccess(env, "owner", "team")).rejects.toThrow();
  });
  test("origin and content-type validation protects read and mutation surfaces", () => {
    const env = {} as Env;
    for (const headers of [
      { origin: "https://evil.example" },
      { "sec-fetch-site": "cross-site" },
      { origin: "null" },
    ])
      expect(() =>
        assertWorkspaceRequestOrigin(
          env,
          new Request("https://memory.example/v1/workspaces", { headers }),
        ),
      ).toThrow();
    expect(() =>
      assertWorkspaceRequestOrigin(
        env,
        new Request("https://memory.example/v1/workspaces", {
          method: "POST",
          headers: {
            origin: "https://memory.example",
            "content-type": "text/plain",
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      assertWorkspaceRequestOrigin(
        env,
        new Request("https://memory.example/v1/workspaces", {
          method: "POST",
          headers: {
            origin: "https://memory.example",
            "content-type": "application/json",
          },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertWorkspaceRequestOrigin(
        env,
        new Request("http://127.0.0.1:54151/v1/workspaces", {
          headers: { origin: "http://localhost:54152" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertWorkspaceRequestOrigin(
        env,
        new Request("https://memory.example/v1/workspaces", {
          headers: { origin: "http://localhost:54152" },
        }),
      ),
    ).toThrow();
  });
});
