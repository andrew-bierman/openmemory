import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type DogfoodStatus = "blocked" | "failed" | "passed" | "pending";

type VendorEvidence = {
  actor: string;
  checkedAt: string;
  mcpClientId: string;
  notes: string;
  proofUrl: string;
};

type VendorDogfoodConfig = {
  baseUrl: string;
  serverPath: string;
  updatedAt: string;
  vendors: Array<{
    checklist: string[];
    evidence: VendorEvidence | null;
    id: string;
    name: string;
    notes: string;
    oauthMode: "authorization-code-pkce";
    required: boolean;
    status: DogfoodStatus;
    transport: "streamable-http";
  }>;
};

const REQUIRED_VENDOR_IDS = ["mcp-inspector", "cursor", "claude", "chatgpt"];
const CHECKED_DOC_PATHS = [
  "README.md",
  "docs/mcp-compatibility.md",
  "docs/launch-readiness.md",
  "docs/release-qualification.md",
  "docs/roadmap.md",
];

const allowPending = process.argv.includes("--allow-pending");
const configPath = resolve("config/mcp-vendor-dogfood.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
assertDogfoodConfig(config);

const docs = new Map<string, string>();
for (const path of CHECKED_DOC_PATHS) {
  docs.set(path, await readFile(resolve(path), "utf8"));
}

const serverUrl = new URL(config.serverPath, config.baseUrl);
assert(serverUrl.pathname === "/mcp", "serverPath must resolve to /mcp.");
assert(
  /^\d{4}-\d{2}-\d{2}$/.test(config.updatedAt),
  "updatedAt must be YYYY-MM-DD.",
);

const vendorsById = new Map(
  config.vendors.map((vendor) => [vendor.id, vendor]),
);
for (const requiredId of REQUIRED_VENDOR_IDS) {
  assert(vendorsById.has(requiredId), `Missing required vendor ${requiredId}.`);
}

const seenIds = new Set<string>();
const failures: string[] = [];

for (const vendor of config.vendors) {
  assert(!seenIds.has(vendor.id), `Duplicate vendor id ${vendor.id}.`);
  seenIds.add(vendor.id);
  assert(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(vendor.id),
    `Vendor id ${vendor.id} must be kebab-case.`,
  );
  assert(vendor.name.trim().length > 0, `${vendor.id} name is required.`);
  assert(
    vendor.transport === "streamable-http",
    `${vendor.id} must use streamable-http.`,
  );
  assert(
    vendor.oauthMode === "authorization-code-pkce",
    `${vendor.id} must use authorization-code-pkce.`,
  );
  assert(
    vendor.checklist.length >= 4,
    `${vendor.id} must include at least four dogfood checklist items.`,
  );
  assert(vendor.notes.trim().length > 0, `${vendor.id} notes are required.`);
  assertDocsMentionVendor(vendor.name, vendor.id);

  if (vendor.status === "passed") {
    assertEvidence(vendor);
    continue;
  }

  if (vendor.evidence !== null) {
    failures.push(
      `${vendor.id} has ${vendor.status} status but includes evidence.`,
    );
  }

  if (vendor.required && !allowPending) {
    failures.push(`${vendor.id} is required but status is ${vendor.status}.`);
  }
}

const pendingRequired = config.vendors.filter(
  (vendor) => vendor.required && vendor.status !== "passed",
);

const statusSummary = config.vendors
  .map(
    (vendor) =>
      `${vendor.id}:${vendor.status}${vendor.required ? ":required" : ""}`,
  )
  .join(", ");

if (failures.length > 0) {
  console.error(`MCP vendor dogfood gate failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(
  `Validated ${config.vendors.length} MCP vendor dogfood entries for ${serverUrl.toString()}`,
);
console.log(`Vendor status: ${statusSummary}`);

if (pendingRequired.length > 0 && allowPending) {
  console.log(
    `Strict launch gate still pending for: ${pendingRequired
      .map((vendor) => vendor.name)
      .join(", ")}`,
  );
}

function assertDogfoodConfig(
  value: unknown,
): asserts value is VendorDogfoodConfig {
  assert(
    typeof value === "object" && value !== null,
    "Config must be an object.",
  );
  const config = value as Partial<VendorDogfoodConfig>;
  assert(typeof config.baseUrl === "string", "baseUrl is required.");
  assert(typeof config.serverPath === "string", "serverPath is required.");
  assert(typeof config.updatedAt === "string", "updatedAt is required.");
  assert(Array.isArray(config.vendors), "vendors must be an array.");

  for (const vendor of config.vendors) {
    assert(
      typeof vendor === "object" && vendor !== null,
      "Each vendor must be an object.",
    );
    const candidate = vendor as Partial<VendorDogfoodConfig["vendors"][number]>;
    assert(typeof candidate.id === "string", "vendor.id is required.");
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
      candidate.transport === "streamable-http",
      `${candidate.id} transport is invalid.`,
    );
    assert(
      candidate.oauthMode === "authorization-code-pkce",
      `${candidate.id} oauthMode is invalid.`,
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

function assertEvidence(vendor: VendorDogfoodConfig["vendors"][number]) {
  assert(
    vendor.evidence !== null,
    `${vendor.id} passed status requires evidence.`,
  );
  assert(
    Date.parse(vendor.evidence.checkedAt) > 0,
    `${vendor.id} evidence.checkedAt must be a parseable date.`,
  );
  assert(
    vendor.evidence.actor.trim().length > 0,
    `${vendor.id} evidence.actor is required.`,
  );
  assert(
    vendor.evidence.mcpClientId.trim().length > 0,
    `${vendor.id} evidence.mcpClientId is required.`,
  );
  assert(
    vendor.evidence.notes.trim().length > 0,
    `${vendor.id} evidence.notes are required.`,
  );
  assert(
    vendor.evidence.proofUrl.startsWith("https://"),
    `${vendor.id} evidence.proofUrl must be an HTTPS URL.`,
  );
}

function assertDocsMentionVendor(name: string, id: string) {
  for (const [path, body] of docs) {
    assert(
      body.includes(name) || body.includes(id),
      `${path} must mention MCP vendor dogfood entry ${name} (${id}).`,
    );
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
