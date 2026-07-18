import type { GraphRelationshipDefinition } from "@openmemory/core";
import { isLocalDevelopmentRequest, type resolveSessionTenant } from "./auth";
import { resolveAuthBaseUrl } from "./better-auth";
import type { Env } from "./env";
import { getRateLimitSettings } from "./operational-controls";

type GraphReadiness = {
  getRelationshipCatalog(): Promise<GraphRelationshipDefinition[]>;
  getStats(): Promise<GraphStats>;
};

type GraphStats = {
  activeMemories: number;
  totalMemories: number;
  totalEdges: number;
  relationshipCount: number;
  relationshipDistribution: Array<{
    relationship: string;
    label: string;
    category: string;
    count: number;
    averageWeight: number;
  }>;
  graphDensity: number;
  entityCount: number;
  tagCount: number;
};

export type ReadinessSnapshot = {
  service: "openmemory-api";
  generatedAt: string;
  tenant: {
    id: string;
    source: "session" | "local-header";
    localDevelopment: boolean;
  };
  graph: {
    activeMemories: number;
    totalMemories: number;
    totalEdges: number;
    relationshipTypes: number;
    graphDensity: number;
    entityCount: number;
    tagCount: number;
  };
  relationships: {
    catalogSize: number;
    top: GraphStats["relationshipDistribution"];
  };
  bindings: Record<
    | "authDb"
    | "durableObjects"
    | "vectorize"
    | "workersAi"
    | "r2Exports"
    | "analytics"
    | "memoryExtractionQueue"
    | "memoryExtractionWorkflow"
    | "sourceIngestionQueue"
    | "sourceIngestionWorkflow",
    boolean
  >;
  auth: {
    mode: "session" | "local-development-header";
    betterAuthUrl: string;
    socialProviders: {
      github: boolean;
      google: boolean;
    };
  };
  mcp: {
    endpoint: string;
    authorizationServer: string;
    protectedResource: string;
    tools: Array<"remember" | "recall" | "profile" | "forget">;
  };
  rateLimit: {
    enabled: boolean;
    limitPerMinute: number;
  };
  exports: {
    r2Configured: boolean;
  };
  warnings: string[];
};

export async function getReadinessSnapshot({
  env,
  graph,
  request,
  sessionTenant,
  tenantId,
}: {
  env: Env;
  graph: GraphReadiness;
  request: Request;
  sessionTenant?: Awaited<ReturnType<typeof resolveSessionTenant>>;
  tenantId: string;
}): Promise<ReadinessSnapshot> {
  const [stats, relationships] = await Promise.all([
    graph.getStats(),
    graph.getRelationshipCatalog(),
  ]);
  const authBaseUrl = resolveAuthBaseUrl(env, request);
  const resourceBaseUrl = resolveResourceBaseUrl(authBaseUrl);
  const rateLimit = getRateLimitSettings(request, env);
  const localDevelopment = isLocalDevelopmentRequest(request);
  const source = sessionTenant ? "session" : "local-header";

  return {
    service: "openmemory-api",
    generatedAt: new Date().toISOString(),
    tenant: {
      id: tenantId,
      source,
      localDevelopment,
    },
    graph: {
      activeMemories: stats.activeMemories,
      totalMemories: stats.totalMemories,
      totalEdges: stats.totalEdges,
      relationshipTypes: stats.relationshipCount,
      graphDensity: stats.graphDensity,
      entityCount: stats.entityCount,
      tagCount: stats.tagCount,
    },
    relationships: {
      catalogSize: relationships.length,
      top: stats.relationshipDistribution.slice(0, 6),
    },
    bindings: {
      authDb: Boolean(env.AUTH_DB),
      durableObjects: Boolean(env.MEMORY_GRAPHS),
      vectorize: Boolean(env.MEMORY_VECTORS),
      workersAi: Boolean(env.AI),
      r2Exports: Boolean(env.MEMORY_EXPORTS),
      analytics: Boolean(env.OPENMEMORY_ANALYTICS),
      memoryExtractionQueue: Boolean(env.MEMORY_EXTRACTION_QUEUE),
      memoryExtractionWorkflow: Boolean(env.MEMORY_EXTRACTION_WORKFLOW),
      sourceIngestionQueue: Boolean(env.SOURCE_INGESTION_QUEUE),
      sourceIngestionWorkflow: Boolean(env.SOURCE_INGESTION_WORKFLOW),
    },
    auth: {
      mode: source === "session" ? "session" : "local-development-header",
      betterAuthUrl: authBaseUrl,
      socialProviders: {
        github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
        google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      },
    },
    mcp: {
      endpoint: `${resourceBaseUrl}/mcp`,
      authorizationServer: `${authBaseUrl}/.well-known/oauth-authorization-server/api/auth`,
      protectedResource: `${resourceBaseUrl}/.well-known/oauth-protected-resource/mcp`,
      tools: ["remember", "recall", "profile", "forget"],
    },
    rateLimit: {
      enabled: rateLimit.enabled,
      limitPerMinute: rateLimit.limit,
    },
    exports: {
      r2Configured: Boolean(env.MEMORY_EXPORTS),
    },
    warnings: getReadinessWarnings({
      env,
      localDevelopment,
      source,
      stats,
    }),
  };
}

function getReadinessWarnings({
  env,
  localDevelopment,
  source,
  stats,
}: {
  env: Env;
  localDevelopment: boolean;
  source: "session" | "local-header";
  stats: GraphStats;
}) {
  const warnings: string[] = [];

  if (source === "local-header" && !localDevelopment) {
    warnings.push("tenant_header_not_allowed_in_production");
  }
  if (!env.AUTH_DB) {
    warnings.push("auth_db_unavailable");
  }
  if (!env.MEMORY_VECTORS || !env.AI) {
    warnings.push("semantic_index_not_fully_configured");
  }
  if (!env.MEMORY_EXPORTS) {
    warnings.push("r2_exports_unavailable");
  }
  if (!env.MEMORY_EXTRACTION_QUEUE || !env.MEMORY_EXTRACTION_WORKFLOW) {
    warnings.push("memory_extraction_async_path_incomplete");
  }
  if (!env.SOURCE_INGESTION_QUEUE || !env.SOURCE_INGESTION_WORKFLOW) {
    warnings.push("source_ingestion_async_path_incomplete");
  }
  if (stats.activeMemories > 0 && stats.totalEdges === 0) {
    warnings.push("graph_has_no_edges");
  }

  return warnings;
}

function resolveResourceBaseUrl(authBaseURL: string) {
  return authBaseURL.endsWith("/api/auth")
    ? authBaseURL.slice(0, -"/api/auth".length)
    : authBaseURL;
}
