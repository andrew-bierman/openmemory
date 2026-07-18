import { treaty } from "@elysia/eden";

export type Memory = {
  id: string;
  content: string;
  tags: string[];
  entityIds: string[];
  type: string;
  status: string;
  isLatest: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Profile = {
  summary: string;
};

export type ContextResult = {
  context: string;
  memories: Memory[];
};

export type SearchResult = Memory & {
  reason: "semantic" | "keyword" | "graph";
  score: number;
};

export type GraphEdge = {
  sourceId: string;
  targetId: string;
  relationship: string;
  weight: number;
  metadata: Record<string, unknown>;
};

export type GraphRelationshipDefinition = {
  relationship: string;
  category: string;
  direction: "forward" | "reverse" | "bidirectional";
  label: string;
  defaultWeight: number;
  description: string;
};

export type GraphStats = {
  totalMemories: number;
  activeMemories: number;
  historicalMemories: number;
  forgottenMemories: number;
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
  generatedAt: string;
};

export type OAuthConnection = {
  clientId: string;
  name: string;
  scopes: string[];
  redirectUris: string[];
  disabled: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type Account = {
  user: {
    id: string;
    email: string;
    name: string;
  };
  workspace: {
    id: string;
    name: string;
    tenantId: string;
    ownerUserId: string;
    createdAt: string;
    updatedAt: string;
  };
  members: WorkspaceMember[];
};

export type WorkspaceMember = {
  id: string;
  email: string;
  role: "owner" | "admin" | "member";
  status: "active" | "invited";
  userId?: string;
  createdAt: string;
  updatedAt: string;
};

export type GraphExportResult = {
  key: string;
  bytes: number;
  memoryCount: number;
  edgeCount: number;
  writtenToR2: boolean;
};

export type GraphImportResult = {
  tenantId: string;
  mode: "replace" | "merge";
  version: 1;
  memoriesImported: number;
  edgesImported: number;
  activeMemoriesIndexed: number;
  memoriesSkipped?: number;
  memoriesOverwritten?: number;
  merged?: {
    memoriesSkipped: number;
    memoriesOverwritten: number;
  };
  replaced?: {
    memoriesDeleted: number;
    edgesDeleted: number;
    tagsDeleted: number;
    entitiesDeleted: number;
    ingestionJobsDeleted: number;
    vectorIndex: {
      attempted: number;
      deleted: number;
      vectorizeConfigured: boolean;
    };
    purgedAt: string;
  };
  importedAt: string;
};

export type GraphImportPreviewResult = {
  tenantId: string;
  mode: "replace" | "merge";
  conflictPolicy: "skip" | "overwrite";
  version: 1;
  previewedAt: string;
  incoming: {
    memories: number;
    edges: number;
  };
  existing: {
    memories: number;
    edges: number;
    tags: number;
    entities: number;
    ingestionJobs: number;
  };
  impact: {
    memoriesImported: number;
    memoriesSkipped: number;
    memoriesOverwritten?: number;
    edgesImported: number;
    wouldDelete: {
      memories: number;
      edges: number;
      tags: number;
      entities: number;
      ingestionJobs: number;
    };
    wouldReplace: boolean;
  };
  conflicts: {
    duplicateMemoryIds: string[];
    duplicateMemoryIdsTruncated: boolean;
    changedMemoryIds: string[];
    changedMemoryIdsTruncated: boolean;
    unchangedMemoryIds: string[];
    unchangedMemoryIdsTruncated: boolean;
    fieldConflicts: Array<{
      id: string;
      fields: string[];
    }>;
    fieldConflictsTruncated: boolean;
  };
  candidates: {
    newMemoryIds: string[];
    newMemoryIdsTruncated: boolean;
  };
};

export type IndexRepairResult = {
  attempted: number;
  expectedVectors: number;
  purgeableMemories: number;
  semanticIndex: SemanticIndexDiagnostic;
  staleVectors: {
    attempted: number;
    deleted: number;
    vectorizeConfigured: boolean;
  };
  tenantId: string;
  vectorizeConfigured: boolean;
};

export type SemanticIndexDiagnostic = {
  configured: boolean;
  workersAiConfigured: boolean;
  vectorizeConfigured: boolean;
  expectedVectors: number;
  staleVectorCandidates: number;
  checkedVectorSample: number;
  missingVectorSample: string[];
  staleVectorSample: string[];
  repairRecommended: boolean;
  status: "current" | "needs_repair" | "unchecked" | "unconfigured";
};

export type TenantExportCleanupResult = {
  r2Configured: boolean;
  prefix: string;
  attempted: number;
  deleted: number;
  failed: number;
  error?: string;
};

export type TenantPurgeResult = {
  tenantId: string;
  memoriesDeleted: number;
  edgesDeleted: number;
  tagsDeleted: number;
  entitiesDeleted: number;
  ingestionJobsDeleted: number;
  vectorIndex: {
    attempted: number;
    deleted: number;
    vectorizeConfigured: boolean;
  };
  exports: TenantExportCleanupResult;
  purgedAt: string;
};

export type AccountDeletionResult = {
  userId: string;
  email: string;
  tenantId: string;
  controlPlane: {
    oauthAccessTokensDeleted: number;
    oauthRefreshTokensDeleted: number;
    oauthConsentsDeleted: number;
    oauthClientsDeleted: number;
    sessionsDeleted: number;
    authAccountsDeleted: number;
    ownedWorkspacesDeleted: number;
    workspaceMembershipsDeleted: number;
    userDeleted: boolean;
  };
  graph: {
    memoriesDeleted: number;
    edgesDeleted: number;
    tagsDeleted: number;
    entitiesDeleted: number;
    ingestionJobsDeleted: number;
    vectorIndex: {
      attempted: number;
      deleted: number;
      vectorizeConfigured: boolean;
    };
    exports: TenantExportCleanupResult;
    purgedAt: string;
  };
  deletedAt: string;
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
  semanticIndex: SemanticIndexDiagnostic;
  warnings: string[];
};

export type CreateMemoryInput = {
  content: string;
  tags?: string[];
  type?: string;
  source?: string;
};

export type IngestResult = {
  memory: Memory;
  edges: GraphEdge[];
};

export type SourceIngestInput = CreateMemoryInput & {
  title?: string;
  metadata?: Record<string, unknown>;
  chunkSize?: number;
  overlap?: number;
};

export type SourceIngestResult = {
  sourceId: string;
  chunkCount: number;
  memories: Memory[];
  edges: GraphEdge[];
};

export type OpenMemoryClientOptions = {
  tenantId?: string;
  token?: string;
  fetch?: typeof fetch;
  credentials?: RequestCredentials;
};

export class OpenMemoryApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function createOpenMemoryClient(
  baseUrl: string,
  options: OpenMemoryClientOptions,
) {
  const requestHeaders = {
    ...(options.tenantId ? { "x-openmemory-user-id": options.tenantId } : {}),
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
  };
  const credentialedFetch = Object.assign(
    (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const fetcher = options.fetch ?? fetch;
      return fetcher(input, {
        ...init,
        credentials: options.credentials ?? "include",
      });
    },
    { preconnect: fetch.preconnect },
  );
  const client = treaty(baseUrl, {
    fetcher: credentialedFetch,
    headers: requestHeaders,
  }) as unknown as EdenClient;

  return {
    eden: client,
    createMemory: (input: CreateMemoryInput) =>
      unwrap<Memory>(client.v1.memories.post(input)),
    forgetMemory: (id: string) =>
      unwrap<Memory>(client.v1.memories({ id }).delete({ reason: "web" })),
    getMemory: (id: string) => unwrap<Memory>(client.v1.memories({ id }).get()),
    getNeighbors: (id: string) =>
      unwrap<GraphEdge[]>(client.v1.graph({ id }).neighbors.get()),
    getGraphStats: () => unwrap<GraphStats>(client.v1.graph.stats.get()),
    getGraphRelationships: () =>
      unwrap<GraphRelationshipDefinition[]>(
        client.v1.graph.relationships.get(),
      ),
    getAccount: () => unwrap<Account>(client.v1.account.get()),
    deleteAccount: (input: { confirmEmail: string; confirmTenantId: string }) =>
      unwrap<AccountDeletionResult>(client.v1.account.delete(input)),
    getReadiness: () => unwrap<ReadinessSnapshot>(client.v1.readiness.get()),
    updateAccountProfile: (name: string) =>
      unwrap<Account>(client.v1.account.profile.patch({ name })),
    renameWorkspace: (name: string) =>
      unwrap<Account>(client.v1.account.workspace.patch({ name })),
    inviteWorkspaceMember: (input: {
      email: string;
      role?: "admin" | "member";
    }) => unwrap<WorkspaceMember>(client.v1.account.members.post(input)),
    removeWorkspaceMember: (memberId: string) =>
      unwrap<Account>(client.v1.account.members({ memberId }).delete()),
    listOAuthConnections: () =>
      unwrap<OAuthConnection[]>(client.v1.oauth.connections.get()),
    revokeOAuthConnection: (clientId: string) =>
      unwrap<{ clientId: string; revoked: boolean }>(
        client.v1.oauth.connections({ clientId }).delete(),
      ),
    exportGraph: () => unwrap<GraphExportResult>(client.v1.exports.post()),
    importGraph: (input: {
      confirmTenantId: string;
      export: unknown;
      mode?: "replace" | "merge";
      conflictPolicy?: "skip" | "overwrite";
    }) =>
      unwrap<GraphImportResult>(
        client.v1.imports.post({
          ...input,
          mode: input.mode ?? "replace",
          conflictPolicy: input.conflictPolicy ?? "skip",
        }),
      ),
    previewGraphImport: (input: {
      confirmTenantId: string;
      export: unknown;
      mode?: "replace" | "merge";
      conflictPolicy?: "skip" | "overwrite";
    }) =>
      unwrap<GraphImportPreviewResult>(
        client.v1.imports.preview.post({
          ...input,
          mode: input.mode ?? "replace",
          conflictPolicy: input.conflictPolicy ?? "skip",
        }),
      ),
    repairIndex: () => unwrap<IndexRepairResult>(client.v1.index.repair.post()),
    purgeTenantData: (confirmTenantId: string) =>
      unwrap<TenantPurgeResult>(client.v1.tenant.delete({ confirmTenantId })),
    ingest: (input: CreateMemoryInput) =>
      unwrap<IngestResult>(client.v1.ingest.post(input)),
    ingestSource: (input: SourceIngestInput) =>
      unwrap<SourceIngestResult>(client.v1.sources.post(input)),
    getContext: (q: string) =>
      unwrap<ContextResult>(
        client.v1.context.post({ q, limit: 8, includeProfile: true }),
      ),
    getProfile: () => unwrap<Profile>(client.v1.profile.get()),
    listMemories: () =>
      unwrap<Memory[]>(
        client.v1.memories.get({ query: { includeHistorical: "true" } }),
      ),
    search: (q: string) =>
      unwrap<SearchResult[]>(client.v1.search.post({ q, limit: 8 })),
  };
}

type EdenResult = Promise<{
  data?: unknown;
  error?: unknown;
  response?: Response;
  status?: number;
}>;

type EdenClient = {
  v1: {
    memories: {
      get(input?: { query?: Record<string, string> }): EdenResult;
      post(input: CreateMemoryInput): EdenResult;
    } & ((params: { id: string }) => {
      get(): EdenResult;
      delete(input?: { reason?: string }): EdenResult;
    });
    ingest: {
      post(input: CreateMemoryInput): EdenResult;
    };
    sources: {
      post(input: SourceIngestInput): EdenResult;
    };
    context: {
      post(input: {
        q: string;
        limit?: number;
        includeProfile?: boolean;
      }): EdenResult;
    };
    profile: {
      get(): EdenResult;
    };
    account: {
      get(): EdenResult;
      delete(input: {
        confirmEmail: string;
        confirmTenantId: string;
      }): EdenResult;
      profile: {
        patch(input: { name: string }): EdenResult;
      };
      workspace: {
        patch(input: { name: string }): EdenResult;
      };
      members: {
        post(input: { email: string; role?: "admin" | "member" }): EdenResult;
      } & ((params: { memberId: string }) => {
        delete(): EdenResult;
      });
    };
    readiness: {
      get(): EdenResult;
    };
    tenant: {
      delete(input: { confirmTenantId: string }): EdenResult;
    };
    oauth: {
      connections: {
        get(): EdenResult;
      } & ((params: { clientId: string }) => {
        delete(): EdenResult;
      });
    };
    exports: {
      post(): EdenResult;
    };
    imports: {
      preview: {
        post(input: {
          confirmTenantId: string;
          mode: "replace" | "merge";
          conflictPolicy?: "skip" | "overwrite";
          export: unknown;
        }): EdenResult;
      };
      post(input: {
        confirmTenantId: string;
        mode: "replace" | "merge";
        conflictPolicy?: "skip" | "overwrite";
        export: unknown;
      }): EdenResult;
    };
    index: {
      repair: {
        post(): EdenResult;
      };
    };
    search: {
      post(input: { q: string; limit?: number }): EdenResult;
    };
    graph: ((params: { id: string }) => {
      neighbors: {
        get(): EdenResult;
      };
    }) & {
      stats: {
        get(): EdenResult;
      };
      relationships: {
        get(): EdenResult;
      };
      edges: {
        post(input: GraphEdge): EdenResult;
      };
    };
  };
};

async function unwrap<T>(resultPromise: EdenResult) {
  const result = await resultPromise;
  if (result.error || result.data === undefined) {
    throw new OpenMemoryApiError(
      formatEdenError(result.error),
      result.status ?? result.response?.status ?? 500,
    );
  }

  return result.data as T;
}

function formatEdenError(error: unknown) {
  if (!error) {
    return "OpenMemory API returned an empty response.";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "OpenMemory API request failed.";
  }
}
