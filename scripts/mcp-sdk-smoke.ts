import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
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

type ClientProfile = {
  expectedTools: string[];
  id: string;
  userAgent: string;
};

const profiles = await loadProfiles();

const worker = await startWorker();
try {
  for (const profile of profiles) {
    await runSdkSmoke(worker.baseUrl, profile);
  }
} finally {
  await worker.stop();
}

async function runSdkSmoke(baseUrl: string, profile: ClientProfile) {
  const tenantId = `mcp-sdk-${profile.id}-${crypto.randomUUID()}`;
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp`),
    {
      requestInit: {
        headers: {
          "user-agent": profile.userAgent,
          "x-openmemory-user-id": tenantId,
        },
      },
    },
  );
  const client = new Client({
    name: `openmemory-${profile.id}`,
    version: "0.1.0",
  });

  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    for (const tool of profile.expectedTools) {
      assertIncludes(toolNames, tool);
    }

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

async function loadProfiles(): Promise<ClientProfile[]> {
  const raw = await readFile(
    join(repoRoot, "config/mcp-client-profiles.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as {
    profiles?: Array<Partial<ClientProfile>>;
  };
  const profiles = parsed.profiles ?? [];
  if (profiles.length === 0) {
    throw new Error("No MCP client profiles configured.");
  }

  return profiles.map((profile) => {
    if (
      !profile.id ||
      !profile.userAgent ||
      !Array.isArray(profile.expectedTools)
    ) {
      throw new Error(`Invalid MCP client profile: ${JSON.stringify(profile)}`);
    }

    return {
      expectedTools: profile.expectedTools,
      id: profile.id,
      userAgent: profile.userAgent,
    };
  });
}

function assertIncludes(values: string[], expected: string) {
  if (!values.includes(expected)) {
    throw new Error(`Expected ${expected}; got ${values.join(", ")}`);
  }
}

async function startWorker() {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await startWorkerOnce();
    } catch (error) {
      lastError = error;
      if (!isWranglerAddressInUse(error) || attempt === 3) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function startWorkerOnce() {
  const port = await getAvailablePort();
  const persistTo = join(testTmpRoot, crypto.randomUUID());
  await mkdir(persistTo, { recursive: true });

  const proc = spawn(
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
  collectOutput(proc.stdout, output);
  collectOutput(proc.stderr, output);

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl, proc, output);
  } catch (error) {
    await stopWorker(proc, persistTo);
    throw error;
  }

  return {
    baseUrl,
    stop: () => stopWorker(proc, persistTo),
  };
}

async function stopWorker(
  proc: ChildProcessWithoutNullStreams,
  persistTo: string,
) {
  proc.kill("SIGTERM");
  await Promise.race([waitForExit(proc), sleep(3_000)]);
  if (proc.exitCode === null) {
    proc.kill("SIGKILL");
    await waitForExit(proc);
  }
  await rm(persistTo, { force: true, recursive: true });
}

function isWranglerAddressInUse(error: unknown) {
  return (
    error instanceof Error && error.message.includes("Address already in use")
  );
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
