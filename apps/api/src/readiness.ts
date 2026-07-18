import type { GraphRelationshipDefinition } from "@openmemory/core";
import { isLocalDevelopmentRequest, type resolveSessionTenant } from "./auth";
import { resolveAuthBaseUrl } from "./better-auth";
import type { Env } from "./env";
import { getRateLimitSettings } from "./operational-controls";
import {
  getSemanticIndexDiagnostic,
  type SemanticIndexDiagnostic,
} from "./semantic-index";

type GraphReadiness = {
  getIndexInventory(): Promise<IndexInventory>;
  getRelationshipCatalog(): Promise<GraphRelationshipDefinition[]>;
  getStats(): Promise<GraphStats>;
};

type IndexInventory = {
  indexableMemories: number;
  purgeableMemories: number;
  indexableMemoryIds: string[];
  purgeableMemoryIds: string[];
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
    socialProviders: SocialProviderReadiness;
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
  semanticIndex: SemanticIndexDiagnostic;
  rerank: RerankReadiness;
  warnings: string[];
};

type RerankReadiness = {
  configured: boolean;
  workersAiConfigured: boolean;
  model?: string;
  timeoutMs: number;
  status: "enabled" | "disabled" | "misconfigured";
};

type SocialProviderReadiness = Record<
  "github" | "google",
  {
    configured: boolean;
    hasClientId: boolean;
    hasClientSecret: boolean;
    status: "ready" | "missing" | "partial";
  }
>;

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
  const [stats, relationships, indexInventory] = await Promise.all([
    graph.getStats(),
    graph.getRelationshipCatalog(),
    graph.getIndexInventory(),
  ]);
  const semanticIndex = await getSemanticIndexDiagnostic(
    env,
    tenantId,
    indexInventory,
  );
  const authBaseUrl = resolveAuthBaseUrl(env, request);
  const resourceBaseUrl = resolveResourceBaseUrl(authBaseUrl);
  const rateLimit = getRateLimitSettings(request, env);
  const localDevelopment = isLocalDevelopmentRequest(request);
  const source = sessionTenant ? "session" : "local-header";
  const rerank = getRerankReadiness(env);
  const socialProviders = getSocialProviderReadiness(env);

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
      socialProviders,
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
    semanticIndex,
    rerank,
    warnings: getReadinessWarnings({
      env,
      localDevelopment,
      rerank,
      semanticIndex,
      socialProviders,
      source,
      stats,
    }),
  };
}

function getReadinessWarnings({
  env,
  localDevelopment,
  rerank,
  semanticIndex,
  socialProviders,
  source,
  stats,
}: {
  env: Env;
  localDevelopment: boolean;
  rerank: RerankReadiness;
  semanticIndex: SemanticIndexDiagnostic;
  socialProviders: SocialProviderReadiness;
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
  if (rerank.status === "misconfigured") {
    warnings.push("rerank_model_requires_workers_ai");
  }
  for (const [provider, readiness] of Object.entries(socialProviders)) {
    if (readiness.status === "partial") {
      warnings.push(`${provider}_oauth_provider_partial`);
    }
  }
  if (semanticIndex.status === "needs_repair") {
    warnings.push("semantic_index_needs_repair");
  }
  if (semanticIndex.status === "unchecked") {
    warnings.push("semantic_index_unchecked");
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

function getSocialProviderReadiness(env: Env): SocialProviderReadiness {
  return {
    github: providerReadiness(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
    google: providerReadiness(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
  };
}

function providerReadiness(
  clientId: string | undefined,
  clientSecret: string | undefined,
) {
  const hasClientId = Boolean(normalizeOptionalEnv(clientId));
  const hasClientSecret = Boolean(normalizeOptionalEnv(clientSecret));
  const configured = hasClientId && hasClientSecret;
  return {
    configured,
    hasClientId,
    hasClientSecret,
    status: configured
      ? "ready"
      : hasClientId || hasClientSecret
        ? "partial"
        : "missing",
  } as const;
}

function getRerankReadiness(env: Env): RerankReadiness {
  const model = normalizeOptionalEnv(env.OPENMEMORY_RERANK_MODEL);
  const configured = Boolean(model);
  const workersAiConfigured = Boolean(env.AI);
  const timeoutMs = parsePositiveInteger(env.OPENMEMORY_RERANK_TIMEOUT_MS, 900);

  return {
    configured,
    workersAiConfigured,
    ...(model ? { model } : {}),
    timeoutMs,
    status: configured
      ? workersAiConfigured
        ? "enabled"
        : "misconfigured"
      : "disabled",
  };
}

function normalizeOptionalEnv(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function resolveResourceBaseUrl(authBaseURL: string) {
  return authBaseURL.endsWith("/api/auth")
    ? authBaseURL.slice(0, -"/api/auth".length)
    : authBaseURL;
}
