import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type ReviewStatus = "blocked" | "failed" | "passed" | "pending";

type CurrentEvidence = {
  averageRecallMs?: number;
  duplicateRowsIgnored?: number;
  latestRecallMs?: number;
  recallThresholdMs?: number;
  uniqueRunsAnalyzed?: number;
  workflowRunUrl?: string;
};

type ReviewEvidence = {
  actor: string;
  checkedAt: string;
  decision: string;
  notes: string;
  proofUrl: string;
};

type RagProductionReviewConfig = {
  baseUrl: string;
  minimumUniqueBenchmarkRuns: number;
  reviewItems: Array<{
    acceptanceCriteria: string[];
    currentEvidence: CurrentEvidence | null;
    evidenceSource:
      | "benchmark-artifacts-and-production-traces"
      | "live-production-benchmark-summary"
      | "live-smoke-and-analytics-traces";
    id:
      | "hosted-graph-benchmark-trend"
      | "rerank-threshold-review"
      | "semantic-rag-trace-review";
    name: string;
    notes: string;
    required: boolean;
    review: ReviewEvidence | null;
    status: ReviewStatus;
  }>;
  updatedAt: string;
};

const REQUIRED_REVIEW_IDS = [
  "hosted-graph-benchmark-trend",
  "semantic-rag-trace-review",
  "rerank-threshold-review",
] as const;
const CHECKED_DOC_PATHS = [
  "README.md",
  "docs/launch-readiness.md",
  "docs/release-qualification.md",
  "docs/roadmap.md",
  "docs/observability.md",
];

const allowPending = process.argv.includes("--allow-pending");
const configPath = resolve("config/rag-production-review.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
assertConfig(config);

assert(new URL(config.baseUrl).protocol === "https:", "baseUrl must be HTTPS.");
assert(
  /^\d{4}-\d{2}-\d{2}$/.test(config.updatedAt),
  "updatedAt must be YYYY-MM-DD.",
);
assert(
  config.minimumUniqueBenchmarkRuns >= 5,
  "minimumUniqueBenchmarkRuns must be at least 5 for hosted launch review.",
);

const docs = new Map<string, string>();
for (const path of CHECKED_DOC_PATHS) {
  docs.set(path, await readFile(resolve(path), "utf8"));
}

const reviewItemsById = new Map(
  config.reviewItems.map((item) => [item.id, item]),
);
for (const reviewId of REQUIRED_REVIEW_IDS) {
  assert(
    reviewItemsById.has(reviewId),
    `Missing required RAG production review item ${reviewId}.`,
  );
}

const seenIds = new Set<string>();
const failures: string[] = [];

for (const item of config.reviewItems) {
  assert(
    !seenIds.has(item.id),
    `Duplicate RAG production review item id ${item.id}.`,
  );
  seenIds.add(item.id);
  assert(item.name.trim().length > 0, `${item.id} name is required.`);
  assert(item.notes.trim().length > 0, `${item.id} notes are required.`);
  assert(
    item.acceptanceCriteria.length >= 3,
    `${item.id} must include at least three acceptance criteria.`,
  );
  assertDocsMentionItem(item.name, item.id);

  if (item.id === "hosted-graph-benchmark-trend") {
    assertBenchmarkTrendEvidence(item);
  }

  if (item.status === "passed") {
    assertReviewEvidence(item);
    continue;
  }

  if (item.review !== null) {
    failures.push(
      `${item.id} has ${item.status} status but includes review evidence.`,
    );
  }

  if (item.required && !allowPending) {
    failures.push(`${item.id} is required but status is ${item.status}.`);
  }
}

const pendingRequired = config.reviewItems.filter(
  (item) => item.required && item.status !== "passed",
);
const statusSummary = config.reviewItems
  .map((item) => `${item.id}:${item.status}${item.required ? ":required" : ""}`)
  .join(", ");

if (failures.length > 0) {
  console.error(
    `RAG production review gate failed:\n- ${failures.join("\n- ")}`,
  );
  process.exit(1);
}

console.log(
  `Validated ${config.reviewItems.length} RAG production review items for ${config.baseUrl}`,
);
console.log(`Review status: ${statusSummary}`);

if (pendingRequired.length > 0 && allowPending) {
  console.log(
    `Strict RAG production review gate still pending for: ${pendingRequired
      .map((item) => item.name)
      .join(", ")}`,
  );
}

function assertConfig(
  value: unknown,
): asserts value is RagProductionReviewConfig {
  assert(
    typeof value === "object" && value !== null,
    "Config must be an object.",
  );
  const config = value as Partial<RagProductionReviewConfig>;
  assert(typeof config.baseUrl === "string", "baseUrl is required.");
  assert(typeof config.updatedAt === "string", "updatedAt is required.");
  assert(
    typeof config.minimumUniqueBenchmarkRuns === "number" &&
      Number.isFinite(config.minimumUniqueBenchmarkRuns),
    "minimumUniqueBenchmarkRuns must be a finite number.",
  );
  assert(Array.isArray(config.reviewItems), "reviewItems must be an array.");

  for (const item of config.reviewItems) {
    assert(
      typeof item === "object" && item !== null,
      "Each review item must be an object.",
    );
    const candidate = item as Partial<
      RagProductionReviewConfig["reviewItems"][number]
    >;
    assert(
      candidate.id === "hosted-graph-benchmark-trend" ||
        candidate.id === "rerank-threshold-review" ||
        candidate.id === "semantic-rag-trace-review",
      "review item id is invalid.",
    );
    assert(
      typeof candidate.name === "string",
      `${candidate.id} name is required.`,
    );
    assert(
      typeof candidate.required === "boolean",
      `${candidate.id} required must be a boolean.`,
    );
    assert(
      candidate.status === "blocked" ||
        candidate.status === "failed" ||
        candidate.status === "passed" ||
        candidate.status === "pending",
      `${candidate.id} status is invalid.`,
    );
    assert(
      candidate.evidenceSource ===
        "benchmark-artifacts-and-production-traces" ||
        candidate.evidenceSource === "live-production-benchmark-summary" ||
        candidate.evidenceSource === "live-smoke-and-analytics-traces",
      `${candidate.id} evidenceSource is invalid.`,
    );
    assert(
      candidate.currentEvidence === null ||
        (typeof candidate.currentEvidence === "object" &&
          candidate.currentEvidence !== null),
      `${candidate.id} currentEvidence must be null or an object.`,
    );
    assert(
      Array.isArray(candidate.acceptanceCriteria),
      `${candidate.id} acceptanceCriteria must be an array.`,
    );
    assert(
      candidate.review === null ||
        (typeof candidate.review === "object" && candidate.review !== null),
      `${candidate.id} review must be null or an object.`,
    );
    assert(
      typeof candidate.notes === "string",
      `${candidate.id} notes are required.`,
    );
  }
}

function assertBenchmarkTrendEvidence(
  item: RagProductionReviewConfig["reviewItems"][number],
) {
  assert(
    item.currentEvidence !== null,
    `${item.id} currentEvidence is required.`,
  );
  const evidence = item.currentEvidence;
  assert(
    typeof evidence.workflowRunUrl === "string" &&
      evidence.workflowRunUrl.startsWith("https://github.com/"),
    `${item.id} workflowRunUrl must be a GitHub Actions URL.`,
  );
  assert(
    typeof evidence.uniqueRunsAnalyzed === "number" &&
      evidence.uniqueRunsAnalyzed >= config.minimumUniqueBenchmarkRuns,
    `${item.id} must analyze at least ${config.minimumUniqueBenchmarkRuns} unique runs.`,
  );
  assert(
    typeof evidence.duplicateRowsIgnored === "number" &&
      evidence.duplicateRowsIgnored >= 0,
    `${item.id} duplicateRowsIgnored must be non-negative.`,
  );
  assert(
    typeof evidence.latestRecallMs === "number" &&
      typeof evidence.averageRecallMs === "number" &&
      typeof evidence.recallThresholdMs === "number",
    `${item.id} recall latency evidence is required.`,
  );
  assert(
    evidence.latestRecallMs <= evidence.recallThresholdMs,
    `${item.id} latest recall latency exceeds threshold.`,
  );
  assert(
    evidence.averageRecallMs <= evidence.recallThresholdMs,
    `${item.id} average recall latency exceeds threshold.`,
  );
}

function assertReviewEvidence(
  item: RagProductionReviewConfig["reviewItems"][number],
) {
  assert(
    item.review !== null,
    `${item.id} passed status requires review evidence.`,
  );
  assert(
    Date.parse(item.review.checkedAt) > 0,
    `${item.id} review.checkedAt must be parseable.`,
  );
  assert(
    item.review.actor.trim().length > 0,
    `${item.id} review.actor is required.`,
  );
  assert(
    item.review.decision.trim().length > 0,
    `${item.id} review.decision is required.`,
  );
  assert(
    item.review.notes.trim().length > 0,
    `${item.id} review.notes are required.`,
  );
  assert(
    item.review.proofUrl.startsWith("https://"),
    `${item.id} review.proofUrl must be HTTPS.`,
  );
}

function assertDocsMentionItem(name: string, id: string) {
  for (const [path, body] of docs) {
    const normalizedBody = normalizeText(body);
    assert(
      normalizedBody.includes(normalizeText(name)) ||
        normalizedBody.includes(id),
      `${path} must mention RAG production review item ${name} (${id}).`,
    );
  }
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
