import {
  type ContextInput,
  ContextSchema,
  type SearchInput,
  type SearchResult,
  SearchSchema,
} from "@openmemory/core";
import type { Env } from "./env";
import type { MemoryGraph } from "./memory-graph";
import { semanticSearch } from "./semantic-index";

type RecallGraph = Pick<MemoryGraph, "getProfile" | "search">;

type RecallContext = {
  query: string;
  profile?: Awaited<ReturnType<MemoryGraph["getProfile"]>>;
  memories: SearchResult[];
  context: string;
  rerank: RerankMetadata;
};

type RerankMetadata = {
  attempted: boolean;
  applied: boolean;
  model?: string;
  candidateCount: number;
  reason?: string;
};

type RerankFailureReason = "timeout" | "provider_error" | "invalid_output";

class RerankFailure extends Error {
  constructor(readonly reason: RerankFailureReason) {
    super(reason);
  }
}

type WorkersAiRerankResponse = {
  response?: unknown;
  result?: unknown;
  choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
};

export async function searchMemories(
  env: Env,
  tenantId: string,
  graph: RecallGraph,
  input: Partial<SearchInput> & { q: string },
) {
  const data = SearchSchema.parse({
    limit: 10,
    tags: [],
    ...input,
  });
  const semanticIds = await semanticSearch(env, tenantId, data.q, data.limit);
  const results = await graph.search({ ...data, semanticIds });

  return rerankSearchResults(env, data.q, results);
}

export async function buildRecallContext(
  env: Env,
  tenantId: string,
  graph: RecallGraph,
  input: ContextInput,
): Promise<RecallContext> {
  const data = ContextSchema.parse(input);
  const memories = await searchMemories(env, tenantId, graph, {
    q: data.q,
    limit: data.limit,
    tags: [],
    includeHistorical: data.includeHistorical,
  });
  const profile = data.includeProfile ? await graph.getProfile() : undefined;

  return {
    query: data.q,
    profile,
    memories,
    context: assembleContext(profile?.summary, memories),
    rerank: getRerankMetadata(memories),
  };
}

export async function rerankSearchResults(
  env: Env,
  query: string,
  results: SearchResult[],
) {
  if (!env.AI || !env.OPENMEMORY_RERANK_MODEL || results.length < 2) {
    return results.map((result) => annotateRerank(result, "skipped"));
  }

  const candidates = results.slice(0, 12);
  const timeoutMs = parsePositiveInteger(env.OPENMEMORY_RERANK_TIMEOUT_MS, 900);
  const model = env.OPENMEMORY_RERANK_MODEL;

  try {
    const rerankedIds = await runWorkersAiRerank(
      env,
      model,
      query,
      candidates,
      timeoutMs,
    );
    if (rerankedIds.length === 0) {
      return results.map((result) => annotateRerank(result, "empty", model));
    }

    const order = new Map(rerankedIds.map((id, index) => [id, index]));
    const knownCandidateIds = new Set(candidates.map((result) => result.id));
    const reranked = [...results].sort((a, b) => {
      const aRank = order.has(a.id)
        ? (order.get(a.id) ?? 0)
        : knownCandidateIds.has(a.id)
          ? candidates.length
          : candidates.length + results.indexOf(a);
      const bRank = order.has(b.id)
        ? (order.get(b.id) ?? 0)
        : knownCandidateIds.has(b.id)
          ? candidates.length
          : candidates.length + results.indexOf(b);
      return aRank - bRank;
    });

    return reranked.map((result) => annotateRerank(result, "applied", model));
  } catch (error) {
    const reason =
      error instanceof RerankFailure ? error.reason : "provider_error";
    return results.map((result) =>
      annotateRerank(result, "fallback", model, reason),
    );
  }
}

async function runWorkersAiRerank(
  env: Env,
  model: string,
  query: string,
  candidates: SearchResult[],
  timeoutMs: number,
) {
  const prompt = [
    "Rank OpenMemory candidates by usefulness for the query.",
    'Return JSON only with shape {"ids":["candidate-id"]}.',
    "Prefer current, specific, directly relevant memories. Do not invent ids.",
    "",
    `Query: ${query}`,
    "",
    "Candidates:",
    ...candidates.map(
      (candidate, index) =>
        `${index + 1}. id=${candidate.id} score=${candidate.score.toFixed(3)} type=${candidate.type} tags=${candidate.tags.join(",")} content=${truncate(candidate.content, 700)}`,
    ),
  ].join("\n");

  // Normalize both synchronous throws and async rejections before the timeout race.
  // Promise.race observes late rejections even after its timeout has settled.
  const ai = env.AI;
  if (!ai) throw new RerankFailure("provider_error");
  const inference = Promise.resolve().then(async () => {
    try {
      return await ai.run(model, { prompt, max_tokens: 256 });
    } catch {
      throw new RerankFailure("provider_error");
    }
  });
  const response = await raceTimeout(inference, timeoutMs);

  const ids = parseRerankIds(response);
  const allowed = new Set(candidates.map((candidate) => candidate.id));
  const seen = new Set<string>();
  const validIds = ids.filter((id) => {
    if (!allowed.has(id) || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
  if (ids.length > 0 && validIds.length === 0) {
    throw new RerankFailure("invalid_output");
  }
  return validIds;
}

function parseRerankIds(value: unknown) {
  if (!isRecord(value)) throw new RerankFailure("invalid_output");
  const response = value as WorkersAiRerankResponse;
  const textCandidates = [
    response.response,
    response.result,
    response.choices?.[0]?.message?.content,
    response.choices?.[0]?.text,
  ];
  for (const candidate of textCandidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const parsed = parseJsonObject(candidate);
    if (
      Array.isArray(parsed?.ids) &&
      parsed.ids.every((id) => typeof id === "string")
    ) {
      return parsed.ids as string[];
    }
  }
  throw new RerankFailure("invalid_output");
}

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  if (!jsonText) {
    return undefined;
  }

  try {
    return JSON.parse(jsonText) as { ids?: unknown };
  } catch {
    return undefined;
  }
}

function assembleContext(
  profileSummary: string | undefined,
  memories: SearchResult[],
) {
  const sections = [];
  if (profileSummary) {
    sections.push(`Profile\n${profileSummary}`);
  }
  if (memories.length) {
    sections.push(
      `Relevant memories\n${memories
        .map(
          (memory, index) =>
            `${index + 1}. (${memory.reason}, ${memory.score.toFixed(2)}) ${memory.content}`,
        )
        .join("\n")}`,
    );
  }
  return sections.join("\n\n");
}

function annotateRerank(
  result: SearchResult,
  status: "applied" | "empty" | "fallback" | "skipped",
  model?: string,
  reason?: RerankFailureReason,
): SearchResult {
  return {
    ...result,
    metadata: {
      ...result.metadata,
      rerank: {
        status,
        ...(reason ? { reason } : {}),
        ...(model ? { model } : {}),
      },
    },
  };
}

function getRerankMetadata(memories: SearchResult[]): RerankMetadata {
  const first = memories[0]?.metadata.rerank;
  if (!isRecord(first)) {
    return {
      attempted: false,
      applied: false,
      candidateCount: memories.length,
      reason: "unavailable",
    };
  }

  const status = typeof first.status === "string" ? first.status : "unknown";
  return {
    attempted: status !== "skipped",
    applied: status === "applied",
    model: typeof first.model === "string" ? first.model : undefined,
    candidateCount: memories.length,
    reason: typeof first.reason === "string" ? first.reason : status,
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

async function raceTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new RerankFailure("timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type { RecallContext };
