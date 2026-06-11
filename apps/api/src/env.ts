import type { MemoryGraph } from "./memory-graph";

export type Env = {
  MEMORY_GRAPHS: DurableObjectNamespace<MemoryGraph>;
  AUTH_DB?: D1Database;
  MEMORY_VECTORS?: VectorizeIndex;
  AI?: Ai;
  MEMORY_EXPORTS?: R2Bucket;
  EMBEDDING_MODEL: string;
  OPENMEMORY_API_TOKEN?: string;
  OPENMEMORY_REQUIRE_OAUTH?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};
