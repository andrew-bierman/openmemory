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
  await db
    .delete(oauthAccessToken)
    .where(
      and(
        eq(oauthAccessToken.clientId, clientId),
        eq(oauthAccessToken.userId, session.user.id),
      ),
    );
  await db
    .delete(oauthRefreshToken)
    .where(
      and(
        eq(oauthRefreshToken.clientId, clientId),
        eq(oauthRefreshToken.userId, session.user.id),
      ),
    );
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
