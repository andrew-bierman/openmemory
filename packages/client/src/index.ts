import { treaty } from "@elysia/eden";

export type Memory = {
  id: string;
  content: string;
  tags: string[];
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
  reason: "semantic" | "keyword";
  score: number;
};

export type CreateMemoryInput = {
  content: string;
  tags?: string[];
  type?: string;
};

export type OpenMemoryClientOptions = {
  tenantId: string;
  token?: string;
  fetch?: typeof fetch;
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
  const client = treaty(baseUrl, {
    fetcher: options.fetch,
    headers: {
      "x-openmemory-user-id": options.tenantId,
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
  }) as unknown as EdenClient;

  return {
    eden: client,
    createMemory: (input: CreateMemoryInput) =>
      unwrap<Memory>(client.v1.memories.post(input)),
    forgetMemory: (id: string) =>
      unwrap<Memory>(client.v1.memories({ id }).delete({ reason: "web" })),
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
      delete(input?: { reason?: string }): EdenResult;
    });
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
