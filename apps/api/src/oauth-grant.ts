import { APIError } from "better-auth/api";
import type { Env } from "./env";

type GrantClaims = { tenantId: string; grantId: string; grantVersion: string };

// Capture one generation before the provider concurrently creates access and
// refresh tokens. Both artifacts retain this binding across revocation races.
export function createGrantClaimsResolver(env: Env, request: Request) {
  const identitySnapshot = request.clone();
  const refreshSnapshot = request.clone();
  let captured: Promise<GrantClaims> | undefined;
  let capturedUser: string | undefined;
  async function load(userId: string | undefined): Promise<GrantClaims> {
    if (!env.AUTH_DB || !userId) throw invalidGrant();
    const clientId = await readTokenClientId(identitySnapshot);
    if (!clientId) throw invalidGrant();
    const grant = await env.AUTH_DB.prepare(
      "select id, grant_version from oauth_consent where user_id = ? and client_id = ? limit 1",
    )
      .bind(userId, clientId)
      .first<{ id: string; grant_version: string }>();
    if (!grant?.grant_version) throw invalidGrant();
    const body = refreshSnapshot.headers
      .get("content-type")
      ?.includes("application/json")
      ? ((await refreshSnapshot.json()) as Record<string, unknown>)
      : Object.fromEntries(new URLSearchParams(await refreshSnapshot.text()));
    if (body.grant_type === "refresh_token") {
      const prior = readRefreshBinding(body.refresh_token);
      if (
        !prior ||
        prior.grantId !== grant.id ||
        prior.grantVersion !== grant.grant_version
      )
        throw invalidGrant();
    }
    return {
      tenantId: userId,
      grantId: grant.id,
      grantVersion: grant.grant_version,
    };
  }
  function claims(userId: string | undefined) {
    if (captured && userId !== capturedUser) throw invalidGrant();
    capturedUser = userId;
    captured ??= load(userId);
    return captured;
  }
  return {
    claims,
    async prepare(
      userId: string | undefined,
      grantType: string,
      verificationValue?: unknown,
    ) {
      const current = await claims(userId);
      if (grantType === "authorization_code") {
        const prior = (
          verificationValue as
            | { openMemoryGrant?: Partial<GrantClaims> }
            | undefined
        )?.openMemoryGrant;
        if (
          !prior ||
          prior.grantId !== current.grantId ||
          prior.grantVersion !== current.grantVersion
        )
          throw invalidGrant();
      }
      return {};
    },
    async generateRefreshToken() {
      if (!captured) throw invalidGrant();
      return createBoundRefreshToken(await captured);
    },
  };
}

export async function bindAuthorizationCode(env: Env, value: string) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(value);
  } catch {
    return value;
  }
  if (parsed?.type !== "authorization_code") return value;
  const clientId = (parsed.query as { client_id?: unknown } | undefined)
    ?.client_id;
  if (
    !env.AUTH_DB ||
    typeof parsed.userId !== "string" ||
    typeof clientId !== "string"
  )
    throw invalidGrant();
  const grant = await env.AUTH_DB.prepare(
    "select id, grant_version from oauth_consent where user_id = ? and client_id = ? limit 1",
  )
    .bind(parsed.userId, clientId)
    .first<{ id: string; grant_version: string }>();
  if (!grant?.grant_version) throw invalidGrant();
  return JSON.stringify({
    ...parsed,
    openMemoryGrant: { grantId: grant.id, grantVersion: grant.grant_version },
  });
}

export function createBoundRefreshToken(
  grant: Pick<GrantClaims, "grantId" | "grantVersion">,
) {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const binding = btoa(
    JSON.stringify({
      grantId: grant.grantId,
      grantVersion: grant.grantVersion,
    }),
  );
  return `g1.${nonce}.${binding}`;
}

function readRefreshBinding(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  const parts = value.replace(/^om_rt_/, "").split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== "g1" ||
    !/^[a-f0-9]{64}$/.test(parts[1] ?? "")
  )
    return undefined;
  try {
    const binding = JSON.parse(atob(parts[2] ?? ""));
    return binding &&
      typeof binding.grantId === "string" &&
      typeof binding.grantVersion === "string"
      ? (binding as Pick<GrantClaims, "grantId" | "grantVersion">)
      : undefined;
  } catch {
    return undefined;
  }
}

function invalidGrant() {
  return new APIError("BAD_REQUEST", {
    error: "invalid_grant",
    error_description: "OAuth grant is unavailable or has changed",
  });
}

export async function readTokenClientId(request: Request) {
  if (!new URL(request.url).pathname.endsWith("/oauth2/token"))
    return undefined;
  let bodyClient: unknown;
  if (request.headers.get("content-type")?.includes("application/json")) {
    bodyClient = ((await request.json()) as Record<string, unknown>).client_id;
  } else {
    const body = new URLSearchParams(await request.text());
    if (body.getAll("client_id").length > 1) return undefined;
    bodyClient = body.get("client_id");
  }
  if (bodyClient != null && typeof bodyClient !== "string") return undefined;
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      const decoded = new TextDecoder().decode(
        Uint8Array.from(atob(authorization.slice(6)), (char) =>
          char.charCodeAt(0),
        ),
      );
      const colon = decoded.indexOf(":");
      if (colon < 1 || colon === decoded.length - 1) return undefined;
      const basicClient = decoded.slice(0, colon);
      // The provider prefers Basic. Reject conflicting identities rather than
      // binding a token to a grant selected from a different body identity.
      if (bodyClient && bodyClient !== basicClient) return undefined;
      return basicClient;
    } catch {
      return undefined;
    }
  }
  return typeof bodyClient === "string" && bodyClient ? bodyClient : undefined;
}
