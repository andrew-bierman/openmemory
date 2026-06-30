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

export type GraphStats = {
  totalMemories: number;
  activeMemories: number;
  historicalMemories: number;
  forgottenMemories: number;
  totalEdges: number;
  relationshipCount: number;
  entityCount: number;
  tagCount: number;
  generatedAt: string;
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
