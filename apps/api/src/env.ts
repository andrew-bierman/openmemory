import type {
  Ai,
  D1Database,
  Queue,
  R2Bucket,
  VectorizeIndex,
} from "@cloudflare/workers-types";
import type { MemoryExtractionMessage } from "./extraction-worker";
import type { MemoryGraph } from "./memory-graph";
import type { SourceIngestionMessage } from "./source-ingestion";

export type Env = {
  MEMORY_GRAPHS: MemoryGraphNamespace;
  AUTH_DB?: D1Database;
  MEMORY_VECTORS?: VectorizeIndex;
  AI?: Ai;
  MEMORY_EXPORTS?: R2Bucket;
  OPENMEMORY_ANALYTICS?: AnalyticsEngineBinding;
  MEMORY_EXTRACTION_QUEUE?: Queue<MemoryExtractionMessage>;
  MEMORY_EXTRACTION_WORKFLOW?: WorkflowBinding<MemoryExtractionMessage>;
  SOURCE_INGESTION_QUEUE?: Queue<SourceIngestionMessage>;
  SOURCE_INGESTION_WORKFLOW?: WorkflowBinding<SourceIngestionMessage>;
  EMBEDDING_MODEL: string;
  OPENMEMORY_RERANK_MODEL?: string;
  OPENMEMORY_RERANK_TIMEOUT_MS?: string;
  OPENMEMORY_API_TOKEN?: string;
  OPENMEMORY_RATE_LIMIT_ENABLED?: string;
  OPENMEMORY_RATE_LIMIT_PER_MINUTE?: string;
  OPENMEMORY_BASE_URL?: string;
  OPENMEMORY_ALERT_WEBHOOK_URL?: string;
  OPENMEMORY_ALERT_WEBHOOK_TOKEN?: string;
  OPENMEMORY_ALERT_EMAIL_ENDPOINT?: string;
  OPENMEMORY_ALERT_PAGERDUTY_ROUTING_KEY?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

type MemoryGraphNamespace = {
  idFromName(name: string): MemoryGraphId;
  get(id: MemoryGraphId): MemoryGraph;
};

type MemoryGraphId = unknown;

type AnalyticsEngineBinding = {
  writeDataPoint(event?: {
    blobs?: Array<ArrayBuffer | string | null>;
    doubles?: number[];
    indexes?: Array<ArrayBuffer | string | null>;
  }): void;
};

type WorkflowBinding<T> = {
  create(options?: {
    id?: string;
    params?: T;
    retention?: {
      successRetention?: string;
      errorRetention?: string;
    };
  }): Promise<unknown>;
};
