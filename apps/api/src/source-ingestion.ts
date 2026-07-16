import {
  CreateMemorySchema,
  type IngestSourceInput,
  IngestSourceSchema,
} from "@openmemory/core";
import type { Env } from "./env";
import type { MemoryGraph } from "./memory-graph";
import { enrichMemoryInput } from "./memory-signals";
import { indexMemory } from "./semantic-index";

export const SOURCE_INGESTION_QUEUE_NAME = "openmemory-source-ingestion";

export type SourceIngestionMessage = {
  version: 1;
  sourceId: string;
  tenantId: string;
  input: IngestSourceInput;
  requestedAt: string;
};

export type SourceIngestionResult = {
  sourceId: string;
  chunkCount: number;
  memories: Awaited<ReturnType<MemoryGraph["createMemory"]>>[];
  edges: Awaited<ReturnType<MemoryGraph["addEdge"]>>[];
};

export async function ingestSourceDocument(options: {
  env: Env;
  graph: MemoryGraph;
  input: IngestSourceInput;
  sourceId: string;
  tenantId: string;
}): Promise<SourceIngestionResult> {
  const input = IngestSourceSchema.parse(options.input);
  const chunks = chunkSourceContent(input.content, {
    chunkSize: input.chunkSize,
    overlap: input.overlap,
  });
  const memories: SourceIngestionResult["memories"] = [];
  const edges: SourceIngestionResult["edges"] = [];

  for (const chunk of chunks) {
    const memory = await options.graph.createMemory(
      CreateMemorySchema.parse(
        enrichMemoryInput({
          content: chunk.content,
          source: input.source,
          tags: input.tags,
          metadata: {
            ...input.metadata,
            sourceId: options.sourceId,
            title: input.title,
            chunkIndex: chunk.index,
            chunkCount: chunks.length,
            chunkStart: chunk.start,
            chunkEnd: chunk.end,
            ingestion: {
              strategy: "chunked-source-v1",
              mode: "source-ingestion-pipeline",
              chunkSize: input.chunkSize,
              overlap: input.overlap,
            },
          },
          type: "insight",
        }),
      ),
    );
    await indexMemory(options.env, options.tenantId, memory);
    memories.push(memory);
    edges.push(...(await options.graph.linkRelatedMemories(memory.id)));

    const previous = memories.at(-2);
    if (previous) {
      edges.push(
        await options.graph.addEdge({
          sourceId: previous.id,
          targetId: memory.id,
          relationship: "next_chunk",
          weight: 0.9,
          metadata: {
            sourceId: options.sourceId,
            createdBy: "ingestSource",
          },
        }),
      );
      edges.push(
        await options.graph.addEdge({
          sourceId: memory.id,
          targetId: previous.id,
          relationship: "previous_chunk",
          weight: 0.9,
          metadata: {
            sourceId: options.sourceId,
            createdBy: "ingestSource",
          },
        }),
      );
    }
  }

  return {
    sourceId: options.sourceId,
    chunkCount: memories.length,
    memories,
    edges,
  };
}

export async function processSourceIngestionMessage(
  env: Env,
  message: SourceIngestionMessage,
) {
  const graph = getGraphForTenant(env, message.tenantId);
  await graph.startIngestionJob(message.sourceId);

  try {
    const result = await ingestSourceDocument({
      env,
      graph,
      input: message.input,
      sourceId: message.sourceId,
      tenantId: message.tenantId,
    });
    await graph.completeIngestionJob(message.sourceId, result);
    return result;
  } catch (error) {
    await graph.failIngestionJob(message.sourceId, {
      message: error instanceof Error ? error.message : "unknown error",
    });
    throw error;
  }
}

export function getGraphForTenant(env: Env, tenantId: string) {
  return env.MEMORY_GRAPHS.get(env.MEMORY_GRAPHS.idFromName(tenantId));
}

export function chunkSourceContent(
  content: string,
  options: { chunkSize: number; overlap: number },
) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= options.chunkSize) {
    return [
      {
        content: normalized,
        index: 0,
        start: 0,
        end: normalized.length,
      },
    ];
  }

  const chunks: Array<{
    content: string;
    index: number;
    start: number;
    end: number;
  }> = [];
  const step = Math.max(1, options.chunkSize - options.overlap);
  let start = 0;

  while (start < normalized.length) {
    const hardEnd = Math.min(start + options.chunkSize, normalized.length);
    const end =
      hardEnd === normalized.length
        ? hardEnd
        : findChunkBoundary(normalized, start, hardEnd);
    chunks.push({
      content: normalized.slice(start, end).trim(),
      index: chunks.length,
      start,
      end,
    });

    if (end === normalized.length) {
      break;
    }

    start = Math.max(end - options.overlap, start + step);
  }

  return chunks.filter((chunk) => chunk.content.length > 0);
}

function findChunkBoundary(content: string, start: number, hardEnd: number) {
  const minEnd = start + Math.floor((hardEnd - start) * 0.65);
  const candidate = Math.max(
    content.lastIndexOf(". ", hardEnd),
    content.lastIndexOf("\n", hardEnd),
    content.lastIndexOf(" ", hardEnd),
  );
  return candidate > minEnd ? candidate + 1 : hardEnd;
}
