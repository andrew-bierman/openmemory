import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { resolveOpenMemorySession } from "./better-auth";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
} from "./db/schema";
import type { Env } from "./env";

const DEFAULT_MCP_SCOPES = ["openid", "profile", "memory:read", "memory:write"];
const MAX_REDIRECT_URIS = 10;
const MAX_CLIENT_NAME_LENGTH = 120;
const CLIENT_ID_PREFIX = "om_mcp";

export type CreateOAuthClientInput = {
  name?: string;
  redirectUris?: string[];
  scopes?: string[];
};

export async function listOAuthClients(env: Env, request: Request) {
  const session = await resolveOpenMemorySession(env, request);
  if (!session) {
    return { status: 401, body: { error: "unauthorized" as const } };
  }
  if (!env.AUTH_DB) {
    return { status: 200, body: [] };
  }

  const db = drizzle(env.AUTH_DB);
  const rows = await db
    .select({
      clientId: oauthClient.clientId,
      name: oauthClient.name,
      redirectUris: oauthClient.redirectUris,
      tokenEndpointAuthMethod: oauthClient.tokenEndpointAuthMethod,
      grantTypes: oauthClient.grantTypes,
      responseTypes: oauthClient.responseTypes,
      scopes: oauthClient.scopes,
      public: oauthClient.public,
      disabled: oauthClient.disabled,
      requirePKCE: oauthClient.requirePKCE,
      createdAt: oauthClient.createdAt,
      updatedAt: oauthClient.updatedAt,
    })
    .from(oauthClient)
    .where(eq(oauthClient.userId, session.user.id));

  return {
    status: 200,
    body: rows.map(serializeOAuthClient),
  };
}

export async function createOAuthClient(
  env: Env,
  request: Request,
  input: CreateOAuthClientInput,
) {
  const session = await resolveOpenMemorySession(env, request);
  if (!session) {
    return { status: 401, body: { error: "unauthorized" as const } };
  }
  if (!env.AUTH_DB) {
    return {
      status: 503,
      body: { error: "auth_database_unavailable" as const },
    };
  }

  const parsed = parseOAuthClientInput(input);
  if ("error" in parsed) {
    return { status: 400, body: parsed };
  }

  const now = new Date();
  const db = drizzle(env.AUTH_DB);
  const [created] = await db
    .insert(oauthClient)
    .values({
      id: crypto.randomUUID(),
      clientId: `${CLIENT_ID_PREFIX}_${crypto.randomUUID()}`,
      clientSecret: null,
      name: parsed.name,
      redirectUris: JSON.stringify(parsed.redirectUris),
      tokenEndpointAuthMethod: "none",
      grantTypes: JSON.stringify(["authorization_code", "refresh_token"]),
      responseTypes: JSON.stringify(["code"]),
      scopes: parsed.scopes.join(" "),
      public: true,
      disabled: false,
      skipConsent: false,
      requirePKCE: true,
      referenceId: null,
      metadata: JSON.stringify({
        source: "openmemory-dashboard",
        kind: "mcp",
      }),
      userId: session.user.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning({
      clientId: oauthClient.clientId,
      name: oauthClient.name,
      redirectUris: oauthClient.redirectUris,
      tokenEndpointAuthMethod: oauthClient.tokenEndpointAuthMethod,
      grantTypes: oauthClient.grantTypes,
      responseTypes: oauthClient.responseTypes,
      scopes: oauthClient.scopes,
      public: oauthClient.public,
      disabled: oauthClient.disabled,
      requirePKCE: oauthClient.requirePKCE,
      createdAt: oauthClient.createdAt,
      updatedAt: oauthClient.updatedAt,
    });

  return { status: 201, body: serializeOAuthClient(created) };
}

export async function disableOAuthClient(
  env: Env,
  request: Request,
  clientId: string,
) {
  const session = await resolveOpenMemorySession(env, request);
  if (!session) {
    return { status: 401, body: { error: "unauthorized" as const } };
  }
  if (!env.AUTH_DB) {
    return { status: 404, body: { error: "not_found" as const } };
  }

  const db = drizzle(env.AUTH_DB);
  const now = new Date();
  const result = await db
    .update(oauthClient)
    .set({ disabled: true, updatedAt: now })
    .where(
      and(
        eq(oauthClient.clientId, clientId),
        eq(oauthClient.userId, session.user.id),
      ),
    )
    .returning({ clientId: oauthClient.clientId });

  if (result.length === 0) {
    return { status: 404, body: { error: "not_found" as const } };
  }

  await revokeOAuthTokens(db, clientId, session.user.id);
  await db
    .delete(oauthConsent)
    .where(
      and(
        eq(oauthConsent.clientId, clientId),
        eq(oauthConsent.userId, session.user.id),
      ),
    );

  return {
    status: 200,
    body: {
      clientId,
      disabled: true,
      revoked: true,
    },
  };
}

export async function listOAuthConnections(env: Env, request: Request) {
  const session = await resolveOpenMemorySession(env, request);
  if (!session) {
    return { status: 401, body: { error: "unauthorized" as const } };
  }
  if (!env.AUTH_DB) {
    return { status: 200, body: [] };
  }

  const db = drizzle(env.AUTH_DB);
  const rows = await db
    .select({
      clientId: oauthConsent.clientId,
      scopes: oauthConsent.scopes,
      consentCreatedAt: oauthConsent.createdAt,
      consentUpdatedAt: oauthConsent.updatedAt,
      clientName: oauthClient.name,
      redirectUris: oauthClient.redirectUris,
      disabled: oauthClient.disabled,
    })
    .from(oauthConsent)
    .leftJoin(oauthClient, eq(oauthConsent.clientId, oauthClient.clientId))
    .where(eq(oauthConsent.userId, session.user.id));

  return {
    status: 200,
    body: rows.map((row) => ({
      clientId: row.clientId,
      name: row.clientName ?? row.clientId,
      scopes: splitScope(row.scopes),
      redirectUris: parseJsonStringArray(row.redirectUris),
      disabled: Boolean(row.disabled),
      createdAt: toIso(row.consentCreatedAt),
      updatedAt: toIso(row.consentUpdatedAt),
    })),
  };
}

export async function revokeOAuthConnection(
  env: Env,
  request: Request,
  clientId: string,
) {
  const session = await resolveOpenMemorySession(env, request);
  if (!session) {
    return { status: 401, body: { error: "unauthorized" as const } };
  }
  if (!env.AUTH_DB) {
    return { status: 404, body: { error: "not_found" as const } };
  }

  const db = drizzle(env.AUTH_DB);
  await revokeOAuthTokens(db, clientId, session.user.id);
  const result = await db
    .delete(oauthConsent)
    .where(
      and(
        eq(oauthConsent.clientId, clientId),
        eq(oauthConsent.userId, session.user.id),
      ),
    )
    .returning({ clientId: oauthConsent.clientId });

  if (result.length === 0) {
    return { status: 404, body: { error: "not_found" as const } };
  }

  return {
    status: 200,
    body: {
      clientId,
      revoked: true,
    },
  };
}

async function revokeOAuthTokens(
  db: ReturnType<typeof drizzle>,
  clientId: string,
  userId: string,
) {
  await db
    .delete(oauthAccessToken)
    .where(
      and(
        eq(oauthAccessToken.clientId, clientId),
        eq(oauthAccessToken.userId, userId),
      ),
    );
  await db
    .delete(oauthRefreshToken)
    .where(
      and(
        eq(oauthRefreshToken.clientId, clientId),
        eq(oauthRefreshToken.userId, userId),
      ),
    );
}

function parseOAuthClientInput(input: CreateOAuthClientInput) {
  const name = (input.name ?? "OpenMemory MCP Client").trim();
  if (!name || name.length > MAX_CLIENT_NAME_LENGTH) {
    return {
      error: "invalid_client_name" as const,
      message: `Client name must be between 1 and ${MAX_CLIENT_NAME_LENGTH} characters.`,
    };
  }

  const redirectUris = Array.from(
    new Set(
      (input.redirectUris ?? []).map((uri) => uri.trim()).filter(Boolean),
    ),
  );
  if (redirectUris.length === 0 || redirectUris.length > MAX_REDIRECT_URIS) {
    return {
      error: "invalid_redirect_uris" as const,
      message: `Provide between 1 and ${MAX_REDIRECT_URIS} redirect URIs.`,
    };
  }
  if (!redirectUris.every(isAllowedRedirectUri)) {
    return {
      error: "invalid_redirect_uri" as const,
      message:
        "Redirect URIs must use http://localhost, http://127.0.0.1, or https://.",
    };
  }

  const requestedScopes = input.scopes?.length
    ? input.scopes
    : DEFAULT_MCP_SCOPES;
  const scopes = Array.from(
    new Set(requestedScopes.map((scope) => scope.trim()).filter(Boolean)),
  );
  if (!scopes.every((scope) => DEFAULT_MCP_SCOPES.includes(scope))) {
    return {
      error: "invalid_scope" as const,
      message: `Scopes must be limited to: ${DEFAULT_MCP_SCOPES.join(" ")}.`,
    };
  }

  return { name, redirectUris, scopes };
}

function isAllowedRedirectUri(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") {
      return true;
    }
    if (url.protocol !== "http:") {
      return false;
    }
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function serializeOAuthClient(row: {
  clientId: string;
  name: string | null;
  redirectUris: string | null;
  tokenEndpointAuthMethod: string | null;
  grantTypes: string | null;
  responseTypes: string | null;
  scopes: string | null;
  public: boolean | null;
  disabled: boolean | null;
  requirePKCE: boolean | null;
  createdAt: Date | number | string | null;
  updatedAt: Date | number | string | null;
}) {
  return {
    clientId: row.clientId,
    name: row.name ?? row.clientId,
    redirectUris: parseJsonStringArray(row.redirectUris),
    tokenEndpointAuthMethod: row.tokenEndpointAuthMethod ?? "none",
    grantTypes: parseJsonStringArray(row.grantTypes),
    responseTypes: parseJsonStringArray(row.responseTypes),
    scopes: splitScope(row.scopes),
    public: Boolean(row.public),
    disabled: Boolean(row.disabled),
    requirePKCE: Boolean(row.requirePKCE),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function splitScope(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // Fall back to OAuth's standard space-delimited scope string format.
  }

  return value.split(/\s+/).filter(Boolean);
}

function parseJsonStringArray(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function toIso(value: Date | number | string | null) {
  if (value === null) {
    return undefined;
  }
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
