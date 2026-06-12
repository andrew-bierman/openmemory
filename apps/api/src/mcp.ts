import { mcpHandler as betterAuthMcpHandler } from "@better-auth/oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ContextSchema,
  CreateMemorySchema,
  ForgetMemorySchema,
} from "@openmemory/core";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";
import {
  getGraph,
  isLocalDevelopmentRequest,
  resolveAuth,
  resolveTenant,
} from "./auth";
import { resolveAuthBaseUrl } from "./better-auth";
import type { Env } from "./env";
import type { MemoryGraph } from "./memory-graph";

export function createOpenMemoryMcpHandler() {
  return async (request: Request, env: Env, ctx: ExecutionContext) => {
    if (!isLocalDevelopmentRequest(request)) {
      const baseURL = resolveAuthBaseUrl(env, request);
      return betterAuthMcpHandler(
        {
          verifyOptions: {
            issuer: `${baseURL}/api/auth`,
            audience: `${baseURL}/mcp`,
          },
          jwksUrl: `${baseURL}/api/auth/jwks`,
          scopes: ["memory:read"],
        },
        async (authedRequest, jwt) => {
          const tenantId = getTenantFromJwt(jwt);
          if (!tenantId) {
            return json(
              {
                error: "missing_oauth_subject",
                message: "OAuth token did not include a subject tenant.",
              },
              401,
            );
          }

          return handleMcpRequest(
            withTenantHeader(authedRequest, tenantId),
            env,
            ctx,
          );
        },
      )(request);
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
) {
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
    "createMemory" | "forgetMemory" | "getContext" | "getProfile"
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

  return createMcpHandler(server, {
    route: "/mcp",
    enableJsonResponse: true,
  })(request, env, ctx);
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
