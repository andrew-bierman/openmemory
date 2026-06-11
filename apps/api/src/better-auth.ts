import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { type MemoryDB, memoryAdapter } from "@better-auth/memory-adapter";
import {
  oauthProvider,
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { type BetterAuthOptions, betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
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

  if (pathname.startsWith("/.well-known/oauth-authorization-server")) {
    return oauthProviderAuthServerMetadata(auth)(request);
  }

  if (pathname.startsWith("/.well-known/openid-configuration")) {
    return oauthProviderOpenIdConfigMetadata(auth)(request);
  }

  return auth.handler(request);
}

export function shouldRequireOAuth(env: Env) {
  return env.OPENMEMORY_REQUIRE_OAUTH === "true";
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
