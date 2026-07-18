import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type McpProfileConfig = {
  baseUrl: string;
  oauth: {
    authorizationServerPath: string;
    protectedResourcePath: string;
    scopes: string[];
  };
  profiles: Array<{
    expectedTools: string[];
    id: string;
    label: string;
    notes: string;
    status: "config-shape-smoke" | "tested-in-ci";
    transport: "streamable-http";
    userAgent: string;
  }>;
  serverPath: string;
};

const REQUIRED_TOOLS = ["remember", "recall", "profile", "forget"];
const REQUIRED_SCOPES = ["openid", "profile", "memory:read", "memory:write"];
const configPath = resolve("config/mcp-client-profiles.json");
const docsPath = resolve("docs/mcp-compatibility.md");

const config = JSON.parse(await readFile(configPath, "utf8"));
assertProfileConfig(config);
const docs = await readFile(docsPath, "utf8");

const baseUrl = new URL(config.baseUrl);
const serverUrl = new URL(config.serverPath, baseUrl);
const authorizationServerUrl = new URL(
  config.oauth.authorizationServerPath,
  baseUrl,
);
const protectedResourceUrl = new URL(
  config.oauth.protectedResourcePath,
  baseUrl,
);

assert(serverUrl.pathname === "/mcp", "serverPath must resolve to /mcp.");
assert(
  authorizationServerUrl.pathname.endsWith(
    "/.well-known/oauth-authorization-server/api/auth",
  ),
  "authorizationServerPath must resolve to issuer-scoped Better Auth metadata.",
);
assert(
  protectedResourceUrl.pathname.endsWith(
    "/.well-known/oauth-protected-resource/mcp",
  ),
  "protectedResourcePath must resolve to MCP protected-resource metadata.",
);

for (const scope of REQUIRED_SCOPES) {
  assert(config.oauth.scopes.includes(scope), `Missing OAuth scope ${scope}.`);
}

const ids = new Set<string>();
for (const profile of config.profiles) {
  assert(!ids.has(profile.id), `Duplicate MCP profile id ${profile.id}.`);
  ids.add(profile.id);
  assert(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile.id),
    `Profile id ${profile.id} must be kebab-case.`,
  );
  assert(profile.label.trim().length > 0, `${profile.id} label is required.`);
  assert(
    profile.userAgent.trim().length > 0,
    `${profile.id} userAgent is required.`,
  );
  assert(
    profile.transport === "streamable-http",
    `${profile.id} must use streamable-http.`,
  );
  for (const tool of REQUIRED_TOOLS) {
    assert(
      profile.expectedTools.includes(tool),
      `${profile.id} must expect tool ${tool}.`,
    );
  }
  assert(
    docs.includes(profile.id) || docs.includes(profile.label),
    `docs/mcp-compatibility.md must mention ${profile.id}.`,
  );
}

assert(
  config.profiles.some((profile) => profile.status === "tested-in-ci"),
  "At least one MCP profile must be fully tested in CI.",
);

console.log(
  `Validated ${config.profiles.length} MCP client profiles for ${serverUrl.toString()}`,
);

function assertProfileConfig(
  value: unknown,
): asserts value is McpProfileConfig {
  assert(
    typeof value === "object" && value !== null,
    "Config must be an object.",
  );
  const config = value as Partial<McpProfileConfig>;
  assert(typeof config.baseUrl === "string", "baseUrl is required.");
  assert(typeof config.serverPath === "string", "serverPath is required.");
  assert(Array.isArray(config.profiles), "profiles must be an array.");
  assert(
    typeof config.oauth === "object" && config.oauth !== null,
    "oauth config is required.",
  );
  assert(Array.isArray(config.oauth.scopes), "oauth.scopes must be an array.");
  for (const profile of config.profiles) {
    assert(
      typeof profile === "object" && profile !== null,
      "Each profile must be an object.",
    );
    const candidate = profile as Partial<McpProfileConfig["profiles"][number]>;
    assert(typeof candidate.id === "string", "profile.id is required.");
    assert(
      typeof candidate.label === "string",
      `${candidate.id} label is required.`,
    );
    assert(
      candidate.status === "tested-in-ci" ||
        candidate.status === "config-shape-smoke",
      `${candidate.id} status is invalid.`,
    );
    assert(
      candidate.transport === "streamable-http",
      `${candidate.id} transport is invalid.`,
    );
    assert(
      typeof candidate.userAgent === "string",
      `${candidate.id} userAgent is required.`,
    );
    assert(
      Array.isArray(candidate.expectedTools),
      `${candidate.id} expectedTools must be an array.`,
    );
    assert(
      typeof candidate.notes === "string",
      `${candidate.id} notes are required.`,
    );
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
