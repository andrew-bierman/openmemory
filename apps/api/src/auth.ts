import { normalizeTenantId } from "@openmemory/core";
import { resolveOpenMemorySession } from "./better-auth";
import type { Env } from "./env";

const USER_HEADER = "x-openmemory-user-id";

export type HeaderSource = Headers | Record<string, string | undefined>;

export function resolveTenant(
  headers: HeaderSource,
  options: { allowHeaderTenant?: boolean } = {},
) {
  if (options.allowHeaderTenant === false) {
    return {
      error: "header_tenant_disabled" as const,
      message:
        "Header tenant mode is available only for local development. Use OAuth-backed identity outside localhost.",
    };
  }

  const rawTenant =
    getHeader(headers, USER_HEADER) ?? getHeader(headers, "x-user-id");

  if (!rawTenant) {
    return {
      error: "missing_tenant" as const,
      message: `Pass ${USER_HEADER} for local development. API key auth will replace this header in production.`,
    };
  }

  const tenantId = normalizeTenantId(rawTenant);
  if (!tenantId) {
    return { error: "invalid_tenant" as const };
  }

  return { tenantId };
}

export function resolveAuth(env: Env, headers: HeaderSource) {
  if (!env.OPENMEMORY_API_TOKEN) {
    return { ok: true as const };
  }

  const expected = `Bearer ${env.OPENMEMORY_API_TOKEN}`;
  if (getHeader(headers, "authorization") === expected) {
    return { ok: true as const };
  }

  return {
    ok: false as const,
    error: "unauthorized" as const,
    message: "Pass a valid bearer token.",
  };
}

export const getGraph = (env: Env, tenantId: string) => {
  const id = env.MEMORY_GRAPHS.idFromName(tenantId);
  return env.MEMORY_GRAPHS.get(id);
};

export async function resolveSessionTenant(env: Env, request: Request) {
  try {
    const session = await resolveOpenMemorySession(env, request);
    const rawTenant = session?.user?.id;
    const tenantId =
      typeof rawTenant === "string" ? normalizeTenantId(rawTenant) : undefined;

    return tenantId ? { tenantId } : undefined;
  } catch {
    return undefined;
  }
}

export function isLocalDevelopmentRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function getHeader(headers: HeaderSource, name: string) {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }

  return headers[name] ?? headers[name.toLowerCase()];
}
