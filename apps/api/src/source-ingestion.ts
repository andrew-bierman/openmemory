import {
  type ConversationMessageInput,
  CreateMemorySchema,
  type IngestConversationInput,
  IngestConversationSchema,
  type IngestSourceInput,
  IngestSourceSchema,
} from "@openmemory/core";
import type { Env } from "./env";
import {
  enqueueMemoryExtraction,
  type MemoryExtractionMessage,
} from "./extraction-worker";
import type { MemoryGraph } from "./memory-graph";
import { enrichMemoryInput } from "./memory-signals";
import { indexMemory } from "./semantic-index";

export const SOURCE_INGESTION_QUEUE_NAME = "openmemory-source-ingestion";

export type SourceIngestionMessage = {
  kind?: "source";
  version: 1;
  sourceId: string;
  tenantId: string;
  input: IngestSourceInput;
  requestedAt: string;
};

export type ConversationIngestionMessage = {
  kind: "conversation";
  version: 1;
  sourceId: string;
  tenantId: string;
  input: IngestConversationInput;
  requestedAt: string;
};

export type IngestionQueueMessage =
  | SourceIngestionMessage
  | ConversationIngestionMessage;

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
  extractionReason?: MemoryExtractionMessage["reason"];
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
          conversationId: input.conversationId,
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
    await enqueueMemoryExtraction(options.env, {
      memoryId: memory.id,
      reason: options.extractionReason ?? "source",
      tenantId: options.tenantId,
    });
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

export async function ingestConversationTranscript(options: {
  env: Env;
  graph: MemoryGraph;
  input: IngestConversationInput;
  extractionReason?: MemoryExtractionMessage["reason"];
  sourceId: string;
  tenantId: string;
}): Promise<SourceIngestionResult> {
  const input = IngestConversationSchema.parse(options.input);
  const chunks = chunkConversationMessages(input.messages, {
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
          conversationId: input.conversationId,
          tags: [...new Set([...input.tags, "conversation"])],
          metadata: {
            ...input.metadata,
            sourceId: options.sourceId,
            title: input.title,
            conversationId: input.conversationId,
            messageStartIndex: chunk.messageStartIndex,
            messageEndIndex: chunk.messageEndIndex,
            messageCount: input.messages.length,
            roles: chunk.roles,
            startedAt: chunk.startedAt,
            endedAt: chunk.endedAt,
            ingestion: {
              strategy: "conversation-transcript-v1",
              mode: "conversation-ingestion-pipeline",
              chunkSize: input.chunkSize,
              overlap: input.overlap,
            },
          },
          type: "episode",
          importance: 0.64,
        }),
      ),
    );
    await indexMemory(options.env, options.tenantId, memory);
    await enqueueMemoryExtraction(options.env, {
      memoryId: memory.id,
      reason: options.extractionReason ?? "source",
      tenantId: options.tenantId,
    });
    memories.push(memory);
    edges.push(...(await options.graph.linkRelatedMemories(memory.id)));

    const previous = memories.at(-2);
    if (previous) {
      edges.push(
        await options.graph.addEdge({
          sourceId: previous.id,
          targetId: memory.id,
          relationship: "next_chunk",
          weight: 0.92,
          metadata: {
            sourceId: options.sourceId,
            conversationId: input.conversationId,
            createdBy: "ingestConversation",
          },
        }),
      );
      edges.push(
        await options.graph.addEdge({
          sourceId: memory.id,
          targetId: previous.id,
          relationship: "previous_chunk",
          weight: 0.92,
          metadata: {
            sourceId: options.sourceId,
            conversationId: input.conversationId,
            createdBy: "ingestConversation",
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
  message: IngestionQueueMessage,
) {
  const graph = getGraphForTenant(env, message.tenantId);
  await graph.startIngestionJob(message.sourceId);

  try {
    const result =
      message.kind === "conversation"
        ? await ingestConversationTranscript({
            env,
            graph,
            input: message.input,
            sourceId: message.sourceId,
            tenantId: message.tenantId,
          })
        : await ingestSourceDocument({
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

export function chunkConversationMessages(
  messages: ConversationMessageInput[],
  options: { chunkSize: number; overlap: number },
) {
  const normalizedMessages = messages.map((message, index) => ({
    ...message,
    content: message.content.replace(/\s+/g, " ").trim(),
    index,
  }));
  const chunks: Array<{
    content: string;
    messageStartIndex: number;
    messageEndIndex: number;
    roles: string[];
    startedAt?: string;
    endedAt?: string;
  }> = [];
  let currentMessages: typeof normalizedMessages = [];
  let currentLength = 0;

  for (const message of normalizedMessages) {
    const rendered = renderConversationMessage(message);
    const nextLength =
      currentLength + (currentMessages.length > 0 ? 1 : 0) + rendered.length;
    if (currentMessages.length > 0 && nextLength > options.chunkSize) {
      chunks.push(renderConversationChunk(currentMessages));
      currentMessages = carryOverConversationMessages(
        currentMessages,
        options.overlap,
      );
      currentLength = renderConversationMessages(currentMessages).length;
    }
    currentMessages.push(message);
    currentLength = renderConversationMessages(currentMessages).length;
  }

  if (currentMessages.length > 0) {
    chunks.push(renderConversationChunk(currentMessages));
  }

  return chunks;
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

function renderConversationChunk(
  messages: Array<ConversationMessageInput & { index: number }>,
) {
  return {
    content: renderConversationMessages(messages),
    messageStartIndex: messages[0]?.index ?? 0,
    messageEndIndex: messages.at(-1)?.index ?? 0,
    roles: [...new Set(messages.map((message) => message.role))],
    startedAt: messages.find((message) => message.timestamp)?.timestamp,
    endedAt: messages
      .slice()
      .reverse()
      .find((message) => message.timestamp)?.timestamp,
  };
}

function renderConversationMessages(
  messages: Array<ConversationMessageInput & { index: number }>,
) {
  return messages.map(renderConversationMessage).join("\n").trim();
}

function renderConversationMessage(
  message: ConversationMessageInput & { index: number },
) {
  const speaker = message.name
    ? `${message.role} ${message.name}`
    : message.role;
  const timestamp = message.timestamp ? ` @ ${message.timestamp}` : "";
  return `${message.index + 1}. ${speaker}${timestamp}: ${message.content}`;
}

function carryOverConversationMessages(
  messages: Array<ConversationMessageInput & { index: number }>,
  overlap: number,
) {
  if (overlap <= 0) {
    return [];
  }
  const carried: Array<ConversationMessageInput & { index: number }> = [];
  let length = 0;
  for (const message of messages.slice().reverse()) {
    const rendered = renderConversationMessage(message);
    if (carried.length > 0 && length + rendered.length > overlap) {
      break;
    }
    carried.unshift(message);
    length += rendered.length;
  }
  return carried;
}
