import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const repoRoot = new URL("..", import.meta.url).pathname;
const externalTmpRoot = "/Volumes/CrucialX10/tmp/openmemory-mcp-sdk-smoke";
const testTmpRoot = existsSync("/Volumes/CrucialX10")
  ? externalTmpRoot
  : join(tmpdir(), "openmemory-mcp-sdk-smoke");

const CLIENT_PROFILES = [
  {
    name: "official-typescript-sdk",
    headers: {},
  },
  {
    name: "mcp-inspector-config-shape",
    headers: {
      "user-agent": "MCP-Inspector/OpenMemory-Smoke",
    },
  },
  {
    name: "cursor-remote-mcp-config-shape",
    headers: {
      "user-agent": "Cursor/OpenMemory-Smoke",
    },
  },
  {
    name: "claude-remote-mcp-config-shape",
    headers: {
      "user-agent": "Claude-MCP/OpenMemory-Smoke",
    },
  },
] as const;

const port = await getAvailablePort();
const persistTo = join(testTmpRoot, crypto.randomUUID());
await mkdir(persistTo, { recursive: true });

const worker = spawn(
  "bun",
  [
    "run",
    "--cwd",
    "apps/api",
    "wrangler",
    "dev",
    "--local",
    "--port",
    String(port),
    "--persist-to",
    persistTo,
  ],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      NO_COLOR: "1",
      OPENMEMORY_RATE_LIMIT_PER_MINUTE: "2000",
      WRANGLER_SEND_METRICS: "false",
    },
  },
);

const output: string[] = [];
collectOutput(worker.stdout, output);
collectOutput(worker.stderr, output);

try {
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, worker, output);
  for (const profile of CLIENT_PROFILES) {
    await runSdkSmoke(baseUrl, profile);
  }
} finally {
  worker.kill();
  await waitForExit(worker);
  await rm(persistTo, { force: true, recursive: true });
}

async function runSdkSmoke(
  baseUrl: string,
  profile: (typeof CLIENT_PROFILES)[number],
) {
  const tenantId = `mcp-sdk-${profile.name}-${crypto.randomUUID()}`;
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp`),
    {
      requestInit: {
        headers: {
          ...profile.headers,
          "x-openmemory-user-id": tenantId,
        },
      },
    },
  );
  const client = new Client({
    name: `openmemory-${profile.name}`,
    version: "0.1.0",
  });

  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assertIncludes(toolNames, "remember");
    assertIncludes(toolNames, "recall");
    assertIncludes(toolNames, "profile");
    assertIncludes(toolNames, "forget");

    await client.callTool({
      name: "remember",
      arguments: {
        content: "MCP SDK smoke confirms OpenMemory streamable HTTP.",
        tags: ["mcp", "sdk"],
      },
    });
    const recalled = await client.callTool({
      name: "recall",
      arguments: {
        query: "streamable HTTP SDK smoke",
        limit: 5,
      },
    });
    const recalledText = JSON.stringify(recalled);
    if (!recalledText.includes("streamable HTTP")) {
      throw new Error(
        `Recall result did not include stored memory: ${recalledText}`,
      );
    }
  } finally {
    await client.close();
  }
}

function assertIncludes(values: string[], expected: string) {
  if (!values.includes(expected)) {
    throw new Error(`Expected ${expected}; got ${values.join(", ")}`);
  }
}

async function waitForHealth(
  baseUrl: string,
  proc: ChildProcessWithoutNullStreams,
  output: string[],
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (proc.exitCode !== null) {
      throw new Error(`Wrangler exited early:\n${output.join("")}`);
    }

    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until Wrangler binds the randomized port.
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for Wrangler:\n${output.join("")}`);
}

async function getAvailablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate local port")));
        return;
      }

      const selectedPort = address.port;
      server.close(() => resolve(selectedPort));
    });
  });
}

async function collectOutput(
  stream: NodeJS.ReadableStream | null,
  output: string[],
) {
  if (!stream) {
    return;
  }

  stream.on("data", (chunk) => output.push(String(chunk)));
}

function waitForExit(proc: ChildProcessWithoutNullStreams) {
  if (proc.exitCode !== null) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
