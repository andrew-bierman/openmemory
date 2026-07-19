import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type ProviderStatus = "blocked" | "failed" | "passed" | "pending";

type ProviderEvidence = {
  actor: string;
  checkedAt: string;
  notes: string;
  proofUrl: string;
  readinessStatus: "ready";
  workflowRunUrl: string;
};

type SocialOAuthDogfoodConfig = {
  baseUrl: string;
  readinessPath: string;
  updatedAt: string;
  providers: Array<{
    callbackPaths: string[];
    checklist: string[];
    evidence: ProviderEvidence | null;
    expectedReadinessStatus: "ready";
    id: "github" | "google";
    name: string;
    notes: string;
    required: boolean;
    requiredSecrets: string[];
    status: ProviderStatus;
  }>;
};

const REQUIRED_PROVIDERS = ["github", "google"] as const;
const REQUIRED_DOC_PATHS = [
  "README.md",
  "docs/deployment.md",
  "docs/launch-readiness.md",
  "docs/release-qualification.md",
  "docs/roadmap.md",
];
const REQUIRED_SECRET_NAMES = {
  github: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
} as const;

const allowPending = process.argv.includes("--allow-pending");
const configPath = resolve("config/social-oauth-dogfood.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
assertConfig(config);

const readinessUrl = new URL(config.readinessPath, config.baseUrl);
assert(
  readinessUrl.pathname === "/v1/readiness",
  "readinessPath must resolve to /v1/readiness.",
);
assert(
  /^\d{4}-\d{2}-\d{2}$/.test(config.updatedAt),
  "updatedAt must be YYYY-MM-DD.",
);

const docs = new Map<string, string>();
for (const path of REQUIRED_DOC_PATHS) {
  docs.set(path, await readFile(resolve(path), "utf8"));
}

const providersById = new Map(
  config.providers.map((provider) => [provider.id, provider]),
);
for (const providerId of REQUIRED_PROVIDERS) {
  assert(
    providersById.has(providerId),
    `Missing required social OAuth provider ${providerId}.`,
  );
}

const seenIds = new Set<string>();
const failures: string[] = [];

for (const provider of config.providers) {
  assert(
    !seenIds.has(provider.id),
    `Duplicate social OAuth provider id ${provider.id}.`,
  );
  seenIds.add(provider.id);
  assert(provider.name.trim().length > 0, `${provider.id} name is required.`);
  assert(
    provider.expectedReadinessStatus === "ready",
    `${provider.id} expectedReadinessStatus must be ready.`,
  );
  assert(
    provider.checklist.length >= 4,
    `${provider.id} must include at least four dogfood checklist items.`,
  );
  assert(
    provider.notes.trim().length > 0,
    `${provider.id} notes are required.`,
  );
  assertProviderSecrets(provider);
  assertProviderCallbackPaths(provider);
  assertDocsMentionProvider(provider);

  if (provider.status === "passed") {
    assertEvidence(provider);
    continue;
  }

  if (provider.evidence !== null) {
    failures.push(
      `${provider.id} has ${provider.status} status but includes evidence.`,
    );
  }

  if (provider.required && !allowPending) {
    failures.push(
      `${provider.id} is required but status is ${provider.status}.`,
    );
  }
}

const pendingRequired = config.providers.filter(
  (provider) => provider.required && provider.status !== "passed",
);
const statusSummary = config.providers
  .map(
    (provider) =>
      `${provider.id}:${provider.status}${provider.required ? ":required" : ""}`,
  )
  .join(", ");

if (failures.length > 0) {
  console.error(
    `Social OAuth dogfood gate failed:\n- ${failures.join("\n- ")}`,
  );
  process.exit(1);
}

console.log(
  `Validated ${config.providers.length} social OAuth dogfood entries for ${readinessUrl.toString()}`,
);
console.log(`Provider status: ${statusSummary}`);

if (pendingRequired.length > 0 && allowPending) {
  console.log(
    `Strict social OAuth launch gate still pending for: ${pendingRequired
      .map((provider) => provider.name)
      .join(", ")}`,
  );
}

function assertConfig(
  value: unknown,
): asserts value is SocialOAuthDogfoodConfig {
  assert(
    typeof value === "object" && value !== null,
    "Config must be an object.",
  );
  const config = value as Partial<SocialOAuthDogfoodConfig>;
  assert(typeof config.baseUrl === "string", "baseUrl is required.");
  assert(
    typeof config.readinessPath === "string",
    "readinessPath is required.",
  );
  assert(typeof config.updatedAt === "string", "updatedAt is required.");
  assert(Array.isArray(config.providers), "providers must be an array.");

  for (const provider of config.providers) {
    assert(
      typeof provider === "object" && provider !== null,
      "Each provider must be an object.",
    );
    const candidate = provider as Partial<
      SocialOAuthDogfoodConfig["providers"][number]
    >;
    assert(
      candidate.id === "github" || candidate.id === "google",
      "provider.id must be github or google.",
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
      candidate.expectedReadinessStatus === "ready",
      `${candidate.id} expectedReadinessStatus is invalid.`,
    );
    assert(
      Array.isArray(candidate.requiredSecrets),
      `${candidate.id} requiredSecrets must be an array.`,
    );
    assert(
      Array.isArray(candidate.callbackPaths),
      `${candidate.id} callbackPaths must be an array.`,
    );
    assert(
      Array.isArray(candidate.checklist),
      `${candidate.id} checklist must be an array.`,
    );
    assert(
      candidate.evidence === null ||
        (typeof candidate.evidence === "object" && candidate.evidence !== null),
      `${candidate.id} evidence must be null or an object.`,
    );
    assert(
      typeof candidate.notes === "string",
      `${candidate.id} notes are required.`,
    );
  }
}

function assertProviderSecrets(
  provider: SocialOAuthDogfoodConfig["providers"][number],
) {
  const expectedSecrets = REQUIRED_SECRET_NAMES[provider.id];
  for (const secret of expectedSecrets) {
    assert(
      provider.requiredSecrets.includes(secret),
      `${provider.id} must require ${secret}.`,
    );
    assertDocsInclude(secret, `${secret} must be documented.`);
  }
}

function assertProviderCallbackPaths(
  provider: SocialOAuthDogfoodConfig["providers"][number],
) {
  for (const callbackPath of provider.callbackPaths) {
    assert(
      callbackPath === `/api/auth/callback/${provider.id}`,
      `${provider.id} callback path must be /api/auth/callback/${provider.id}.`,
    );
  }
}

function assertDocsMentionProvider(
  provider: SocialOAuthDogfoodConfig["providers"][number],
) {
  for (const [path, body] of docs) {
    assert(
      body.includes(provider.name) || body.includes(provider.id),
      `${path} must mention social OAuth provider ${provider.name} (${provider.id}).`,
    );
  }
}

function assertDocsInclude(needle: string, message: string) {
  for (const [path, body] of docs) {
    assert(body.includes(needle), `${path}: ${message}`);
  }
}

function assertEvidence(
  provider: SocialOAuthDogfoodConfig["providers"][number],
) {
  assert(
    provider.evidence !== null,
    `${provider.id} passed status requires evidence.`,
  );
  assert(
    provider.evidence.readinessStatus === "ready",
    `${provider.id} evidence.readinessStatus must be ready.`,
  );
  assert(
    Date.parse(provider.evidence.checkedAt) > 0,
    `${provider.id} evidence.checkedAt must be parseable.`,
  );
  assert(
    provider.evidence.actor.trim().length > 0,
    `${provider.id} evidence.actor is required.`,
  );
  assert(
    provider.evidence.notes.trim().length > 0,
    `${provider.id} evidence.notes are required.`,
  );
  assert(
    provider.evidence.proofUrl.startsWith("https://"),
    `${provider.id} evidence.proofUrl must be HTTPS.`,
  );
  assert(
    provider.evidence.workflowRunUrl.startsWith("https://github.com/"),
    `${provider.id} evidence.workflowRunUrl must be a GitHub Actions URL.`,
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
