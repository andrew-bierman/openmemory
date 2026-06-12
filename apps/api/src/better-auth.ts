import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { type MemoryDB, memoryAdapter } from "@better-auth/memory-adapter";
import {
  oauthProvider,
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { type BetterAuthOptions, betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  authAccount,
  authSession,
  authUser,
  authVerification,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
} from "./db/schema";
import type { Env } from "./env";

const AUTH_BASE_PATH = "/api/auth";
const DEFAULT_LOCAL_AUTH_URL = "http://127.0.0.1:8787";
const memoryDb: MemoryDB = {};

export function createOpenMemoryAuth(env: Env, request: Request) {
  const baseURL = resolveAuthBaseUrl(env, request);
  const socialProviders = createSocialProviders(env);

  return betterAuth({
    appName: "OpenMemory",
    basePath: AUTH_BASE_PATH,
    baseURL,
    secret: env.BETTER_AUTH_SECRET ?? "openmemory-local-dev-secret-change-me",
    database: createAuthDatabase(env),
    trustedOrigins: [baseURL],
    emailAndPassword: {
      enabled: true,
    },
    socialProviders,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: baseURL.startsWith("https://"),
      },
    },
    plugins: [
      jwt(),
      oauthProvider({
        scopes: [
          "openid",
          "profile",
          "email",
          "offline_access",
          "memory:read",
          "memory:write",
        ],
        validAudiences: [baseURL, `${baseURL}/mcp`],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        loginPage: "/login",
        consentPage: "/consent",
        prefix: {
          opaqueAccessToken: "om_at_",
          refreshToken: "om_rt_",
          clientSecret: "om_cs_",
        },
        customAccessTokenClaims: ({ user }) => ({
          tenantId: user?.id,
        }),
        customIdTokenClaims: ({ user }) => ({
          "https://openmemory.dev/tenant_id": user.id,
        }),
      }),
    ],
  } satisfies BetterAuthOptions);
}

export function handleOpenMemoryAuthRequest(env: Env, request: Request) {
  const auth = createOpenMemoryAuth(env, request);
  const pathname = new URL(request.url).pathname;

  if (pathname === `${AUTH_BASE_PATH}/get-session`) {
    return handleOpenMemorySessionRequest(env, request);
  }

  if (pathname.startsWith("/.well-known/oauth-authorization-server")) {
    return oauthProviderAuthServerMetadata(auth)(request);
  }

  if (pathname.startsWith("/.well-known/openid-configuration")) {
    return oauthProviderOpenIdConfigMetadata(auth)(request);
  }

  return auth.handler(request);
}

export async function resolveOpenMemorySession(env: Env, request: Request) {
  const token = getSessionToken(request.headers);
  if (!token || !env.AUTH_DB) {
    return undefined;
  }

  const db = drizzle(env.AUTH_DB);
  const rows = await db
    .select({
      session: authSession,
      user: authUser,
    })
    .from(authSession)
    .innerJoin(authUser, eq(authSession.userId, authUser.id))
    .where(eq(authSession.token, token))
    .limit(1);
  const row = rows[0];

  if (!row || toTime(row.session.expiresAt) <= Date.now()) {
    return undefined;
  }

  return row;
}

export function resolveAuthBaseUrl(env: Env, request: Request) {
  if (env.BETTER_AUTH_URL) {
    return trimTrailingSlash(env.BETTER_AUTH_URL);
  }

  const url = new URL(request.url);
  return trimTrailingSlash(url.origin || DEFAULT_LOCAL_AUTH_URL);
}

export function isAuthRoute(pathname: string) {
  return (
    pathname.startsWith(AUTH_BASE_PATH) ||
    pathname.startsWith("/.well-known/oauth-authorization-server") ||
    pathname.startsWith("/.well-known/openid-configuration")
  );
}

function createAuthDatabase(env: Env): BetterAuthOptions["database"] {
  if (!env.AUTH_DB) {
    return memoryAdapter(memoryDb);
  }

  return drizzleAdapter(drizzle(env.AUTH_DB), {
    provider: "sqlite",
    schema: {
      user: authUser,
      session: authSession,
      account: authAccount,
      verification: authVerification,
      oauthClient,
      oauthAccessToken,
      oauthRefreshToken,
      oauthConsent,
    },
    transaction: false,
  });
}

function createSocialProviders(env: Env) {
  return {
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  };
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

async function handleOpenMemorySessionRequest(env: Env, request: Request) {
  const session = await resolveOpenMemorySession(env, request);
  return new Response(JSON.stringify(session ?? null), {
    headers: { "content-type": "application/json" },
  });
}

function getSessionToken(headers: Headers) {
  const cookie = headers.get("cookie");
  if (!cookie) {
    return undefined;
  }

  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (
      rawName === "better-auth.session_token" ||
      rawName === "__Secure-better-auth.session_token"
    ) {
      const value = decodeURIComponent(rawValue.join("="));
      return value.split(".")[0];
    }
  }

  return undefined;
}

function toTime(value: Date | number | string) {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return value < 10_000_000_000 ? value * 1000 : value;
  }

  return new Date(value).getTime();
}
