import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const authUser = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const authSession = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
});

export const authAccount = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const authVerification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const jwks = sqliteTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
});

export const oauthClient = sqliteTable("oauth_client", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  name: text("name"),
  redirectUris: text("redirect_uris").notNull(),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
  grantTypes: text("grant_types"),
  responseTypes: text("response_types"),
  scopes: text("scopes"),
  public: integer("public", { mode: "boolean" }),
  disabled: integer("disabled", { mode: "boolean" }).default(false),
  skipConsent: integer("skip_consent", { mode: "boolean" }),
  requirePKCE: integer("require_pkce", { mode: "boolean" }),
  referenceId: text("reference_id"),
  metadata: text("metadata"),
  userId: text("user_id").references(() => authUser.id, {
    onDelete: "cascade",
  }),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const oauthAccessToken = sqliteTable("oauth_access_token", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  clientId: text("client_id").notNull(),
  sessionId: text("session_id"),
  userId: text("user_id"),
  referenceId: text("reference_id"),
  refreshId: text("refresh_id"),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  scopes: text("scopes").notNull(),
});

export const oauthRefreshToken = sqliteTable("oauth_refresh_token", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  clientId: text("client_id").notNull(),
  sessionId: text("session_id"),
  userId: text("user_id").notNull(),
  referenceId: text("reference_id"),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  revoked: integer("revoked", { mode: "timestamp" }),
  authTime: integer("auth_time", { mode: "timestamp" }),
  scopes: text("scopes").notNull(),
});

export const oauthConsent = sqliteTable(
  "oauth_consent",
  {
    grantVersion: text("grant_version").notNull().default(""),
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    userId: text("user_id").notNull(),
    referenceId: text("reference_id"),
    scopes: text("scopes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("oauth_consent_user_client_idx").on(table.userId, table.clientId),
  ],
);

export const workspace = sqliteTable("workspace", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const workspaceMember = sqliteTable(
  "workspace_member",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => authUser.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => ({
    workspaceUser: uniqueIndex("workspace_member_user_idx")
      .on(table.workspaceId, table.userId)
      .where(sql`${table.acceptedAt} IS NOT NULL`),
    workspaceEmail: uniqueIndex("workspace_member_workspace_email_idx").on(
      table.workspaceId,
      table.email,
    ),
  }),
);

export const workspaceInvitation = sqliteTable(
  "workspace_invitation",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    tokenHash: text("token_hash").notNull(),
    inviterUserId: text("inviter_user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    inviterMemberId: text("inviter_member_id").notNull(),
    targetUserId: text("target_user_id").references(() => authUser.id, {
      onDelete: "cascade",
    }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp" }),
    acceptedUserId: text("accepted_user_id").references(() => authUser.id, {
      onDelete: "cascade",
    }),
    acceptedMemberId: text("accepted_member_id"),
  },
  (table) => [
    uniqueIndex("workspace_invitation_workspace_email_idx").on(
      table.workspaceId,
      table.email,
    ),
  ],
);
export const workspaceShareDirectory = sqliteTable(
  "workspace_share_directory",
  {
    shareId: text("share_id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    memoryId: text("memory_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("workspace_share_directory_page_idx").on(
      table.workspaceId,
      table.createdAt,
      table.shareId,
    ),
  ],
);
export const workspaceAudit = sqliteTable("workspace_audit", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  subjectUserId: text("subject_user_id"),
  memberId: text("member_id"),
  action: text("action").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Epoch milliseconds; separate from Better Auth verification records so OAuth
// codes and refresh grants remain untouched by passwordless consumption.
export const passwordlessOtp = sqliteTable(
  "passwordless_otp",
  {
    email: text("email").primaryKey(),
    hash: text("hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
  },
  (table) => [index("passwordless_otp_expires_at_idx").on(table.expiresAt)],
);

export const passwordlessThrottle = sqliteTable(
  "passwordless_throttle",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("passwordless_throttle_expires_at_idx").on(table.expiresAt),
  ],
);
