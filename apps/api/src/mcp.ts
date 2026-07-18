import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ContextSchema,
  CreateMemorySchema,
  ForgetMemorySchema,
} from "@openmemory/core";
import { createMcpHandler } from "agents/mcp";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import type { JSONWebKeySet } from "jose";
import * as z from "zod/v3";
import {
  getGraph,
  isLocalDevelopmentRequest,
  resolveAuth,
  resolveTenant,
} from "./auth";
import { resolveAuthBaseUrl } from "./better-auth";
import type { Env } from "./env";
import type { MemoryGraph } from "./memory-graph";

export function createOpenMemoryMcpHandler(): (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) => Promise<Response> {
  return async (request: Request, env: Env, ctx: ExecutionContext) => {
    if (!isLocalDevelopmentRequest(request)) {
      const authBaseURL = resolveAuthBaseUrl(env, request);
      const resourceBaseURL = resolveResourceBaseUrl(authBaseURL);
      const jwt = await verifyMcpBearerToken(
        request,
        env,
        authBaseURL,
        resourceBaseURL,
      );
      if ("response" in jwt) {
        return (
          jwt.response ??
          mcpUnauthorized(resourceBaseURL, "invalid access token")
        );
      }

      const tenantId = getTenantFromJwt(jwt.payload);
      if (!tenantId) {
        return json(
          {
            error: "missing_oauth_subject",
            message: "OAuth token did not include a subject tenant.",
          },
          401,
        );
      }

      return handleMcpRequest(withTenantHeader(request, tenantId), env, ctx, {
        allowHeaderTenant: true,
      });
    }

    return handleMcpRequest(request, env, ctx, {
      allowHeaderTenant: true,
    });
  };
}

async function handleMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  options: { allowHeaderTenant: boolean } = { allowHeaderTenant: false },
): Promise<Response> {
  const auth = resolveAuth(env, request.headers);
  if (!auth.ok) {
    return json({ error: auth.error, message: auth.message }, 401);
  }

  const tenant = resolveTenant(request.headers, options);
  if ("error" in tenant) {
    return json(tenant, 401);
  }

  const graph = getGraph(env, tenant.tenantId) as unknown as Pick<
    MemoryGraph,
    | "createMemory"
    | "forgetMemory"
    | "getContext"
    | "getProfile"
    | "listMemories"
  >;
  const server = new McpServer({
    name: "openmemory",
    version: "0.1.0-alpha",
  });

  server.tool(
    "remember",
    "Store a durable memory for this tenant.",
    {
      content: z.string().min(1),
      tags: z.array(z.string()).optional(),
      type: z
        .enum([
          "fact",
          "preference",
          "decision",
          "episode",
          "insight",
          "profile",
        ])
        .optional(),
      metadata: z.record(z.unknown()).optional(),
    },
    async ({ content, tags = [], type = "fact", metadata = {} }) => {
      const memory = await graph.createMemory(
        CreateMemorySchema.parse({
          content,
          source: "mcp",
          tags,
          metadata,
          type,
        }),
      );

      return textTool(`Stored ${memory.id}: ${memory.content}`);
    },
  );

  server.tool(
    "recall",
    "Recall memories and assembled profile context.",
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(30).optional(),
      includeHistorical: z.boolean().optional(),
    },
    async ({ query, limit = 8, includeHistorical = false }) => {
      const context = await graph.getContext(
        ContextSchema.parse({
          q: query,
          limit,
          includeProfile: true,
          includeHistorical,
        }),
      );

      return textTool(context.context || "No matching memories found.");
    },
  );

  server.tool(
    "forget",
    "Soft-forget a memory by ID.",
    {
      id: z.string().min(1),
      reason: z.string().optional(),
    },
    async ({ id, reason }) => {
      const memory = await graph.forgetMemory(
        id,
        ForgetMemorySchema.parse({ reason }),
      );

      return textTool(memory ? `Forgot ${memory.id}` : "Memory not found.");
    },
  );

  server.tool(
    "profile",
    "Return stable and current profile context.",
    {},
    async () => {
      const profile = await graph.getProfile();
      return textTool(profile.summary);
    },
  );

  server.registerResource(
    "profile",
    "openmemory://profile",
    {
      title: "OpenMemory Profile",
      description: "Stable and current profile context for this tenant.",
      mimeType: "text/markdown",
      annotations: {
        audience: ["assistant"],
        priority: 0.9,
      },
    },
    async (uri) => {
      const profile = await graph.getProfile();
      return textResource(uri, profile.summary);
    },
  );

  server.registerResource(
    "recent",
    "openmemory://recent",
    {
      title: "Recent OpenMemory Memories",
      description: "Recent active memories for this tenant.",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant"],
        priority: 0.7,
      },
    },
    async (uri) => {
      const memories = await graph.listMemories(10, false);
      return textResource(
        uri,
        JSON.stringify(
          memories.map((memory) => ({
            id: memory.id,
            content: memory.content,
            tags: memory.tags,
            type: memory.type,
            updatedAt: memory.updatedAt,
          })),
          null,
          2,
        ),
        "application/json",
      );
    },
  );

  server.registerPrompt(
    "context",
    {
      title: "OpenMemory Context",
      description:
        "Inject profile and relevant memory context into an AI conversation.",
      argsSchema: {
        query: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Optional task or question to recall targeted context for.",
          ),
        limit: z
          .string()
          .optional()
          .describe("Maximum recalled memories to include, from 1 to 30."),
      },
    },
    async ({ query = "current user context", limit }) => {
      const parsedLimit = normalizePromptLimit(limit);
      const context = await graph.getContext(
        ContextSchema.parse({
          q: query,
          limit: parsedLimit,
          includeProfile: true,
          includeHistorical: false,
        }),
      );

      return {
        description: "Profile plus relevant OpenMemory recall context.",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                context.context ||
                "No matching OpenMemory context is available yet.",
            },
          },
        ],
      };
    },
  );

  const response = await createMcpHandler(server, {
    route: "/mcp",
    enableJsonResponse: true,
  })(request, env, ctx);
  return response ?? json({ error: "mcp_no_response" }, 500);
}

async function verifyMcpBearerToken(
  request: Request,
  env: Env,
  authBaseURL: string,
  resourceBaseURL: string,
) {
  const issuer = resolveIssuer(authBaseURL);
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : authorization;
  if (!accessToken) {
    return {
      response: mcpUnauthorized(
        resourceBaseURL,
        "missing authorization header",
      ),
    };
  }

  try {
    const payload = await verifyJwsAccessToken(accessToken, {
      jwksFetch: () => readJwks(env, issuer),
      verifyOptions: {
        issuer,
        audience: `${resourceBaseURL}/mcp`,
      },
    });
    const scopes = new Set(String(payload.scope ?? "").split(" "));
    if (!scopes.has("memory:read")) {
      return { response: json({ error: "invalid_scope" }, 403) };
    }
    return { payload };
  } catch (error) {
    return {
      response: mcpUnauthorized(
        resourceBaseURL,
        error instanceof Error ? error.message : "invalid access token",
      ),
    };
  }
}

async function readJwks(env: Env, issuer: string): Promise<JSONWebKeySet> {
  if (!env.AUTH_DB) {
    const response = await fetch(`${issuer}/jwks`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`JWKS fetch failed with ${response.status}`);
    }
    return (await response.json()) as JSONWebKeySet;
  }

  const { results } = await env.AUTH_DB.prepare(
    "select id, public_key from jwks",
  ).all<{
    id: string;
    public_key: string;
  }>();

  return {
    keys: results.map((row) => ({
      ...JSON.parse(row.public_key),
      alg: "EdDSA",
      kid: row.id,
    })),
  };
}

function mcpUnauthorized(resourceBaseURL: string, message: string) {
  return new Response(message, {
    status: 401,
    headers: {
      "www-authenticate": `Bearer resource_metadata="${resourceBaseURL}/.well-known/oauth-protected-resource/mcp"`,
    },
  });
}

function resolveIssuer(authBaseURL: string) {
  return authBaseURL.endsWith("/api/auth")
    ? authBaseURL
    : `${authBaseURL}/api/auth`;
}

function resolveResourceBaseUrl(authBaseURL: string) {
  return authBaseURL.endsWith("/api/auth")
    ? authBaseURL.slice(0, -"/api/auth".length)
    : authBaseURL;
}

function textTool(text: string) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

function textResource(uri: URL, text: string, mimeType = "text/markdown") {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType,
        text,
      },
    ],
  };
}

function normalizePromptLimit(value: string | undefined) {
  if (!value) {
    return 8;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(Math.trunc(parsed), 30))
    : 8;
}

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function getTenantFromJwt(jwt: { sub?: unknown; tenantId?: unknown }) {
  if (typeof jwt.tenantId === "string" && jwt.tenantId.length > 0) {
    return jwt.tenantId;
  }

  return typeof jwt.sub === "string" && jwt.sub.length > 0
    ? jwt.sub
    : undefined;
}

function withTenantHeader(request: Request, tenantId: string) {
  const headers = new Headers(request.headers);
  headers.set("x-openmemory-user-id", tenantId);
  return new Request(request, { headers });
}
