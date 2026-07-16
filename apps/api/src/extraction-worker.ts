import type { Env } from "./env";
import { extractMemorySignals } from "./memory-signals";

export const MEMORY_EXTRACTION_QUEUE_NAME = "openmemory-memory-extraction";

export type MemoryExtractionMessage = {
  version: 1;
  memoryId: string;
  tenantId: string;
  requestedAt: string;
  reason: "create" | "update" | "source";
};

export async function enqueueMemoryExtraction(
  env: Env,
  message: Omit<MemoryExtractionMessage, "requestedAt" | "version">,
) {
  if (!env.MEMORY_EXTRACTION_QUEUE) {
    await processMemoryExtractionMessage(env, {
      ...message,
      version: 1,
      requestedAt: new Date().toISOString(),
    });
    return { queued: false };
  }

  await env.MEMORY_EXTRACTION_QUEUE.send(
    {
      ...message,
      version: 1,
      requestedAt: new Date().toISOString(),
    },
    { contentType: "json" },
  );
  return { queued: true };
}

export async function processMemoryExtractionMessage(
  env: Env,
  message: MemoryExtractionMessage,
) {
  const graph = env.MEMORY_GRAPHS.get(
    env.MEMORY_GRAPHS.idFromName(message.tenantId),
  );
  const memory = await graph.getMemory(message.memoryId);
  if (!memory) {
    return {
      applied: false,
      edgeCount: 0,
      memoryId: message.memoryId,
      reason: "not_found" as const,
    };
  }

  const signals = extractMemorySignals(memory.content);
  const result = await graph.applyExtractedSignals(message.memoryId, signals);
  return {
    applied: result.applied,
    edgeCount: result.edges.length,
    entityCount: signals.entityIds.length,
    memoryId: message.memoryId,
    relationshipCount: signals.relationships.length,
  };
}

export function parseMemoryExtractionMessage(
  value: unknown,
): MemoryExtractionMessage {
  if (!isRecord(value)) {
    throw new Error("Invalid memory extraction queue message.");
  }
  return {
    version: 1,
    memoryId: String(value.memoryId),
    tenantId: String(value.tenantId),
    requestedAt:
      typeof value.requestedAt === "string"
        ? value.requestedAt
        : new Date().toISOString(),
    reason: parseExtractionReason(value.reason),
  };
}

function parseExtractionReason(
  value: unknown,
): MemoryExtractionMessage["reason"] {
  if (value === "update" || value === "source") {
    return value;
  }
  return "create";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
