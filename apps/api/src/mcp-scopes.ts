const MCP_READ_SCOPE = "memory:read";
const MCP_WRITE_SCOPE = "memory:write";
const MCP_WRITE_TOOLS = new Set(["remember", "forget"]);

export async function getRequiredMcpScopesForRequest(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") {
    return new Set([MCP_READ_SCOPE]);
  }

  try {
    return getRequiredMcpScopesForPayload(await request.json());
  } catch {
    return new Set([MCP_READ_SCOPE]);
  }
}

export function getRequiredMcpScopesForPayload(payload: unknown) {
  const requiredScopes = new Set([MCP_READ_SCOPE]);
  const messages = Array.isArray(payload) ? payload : [payload];

  for (const message of messages) {
    if (!isRecord(message) || message.method !== "tools/call") {
      continue;
    }

    const params = message.params;
    if (
      isRecord(params) &&
      typeof params.name === "string" &&
      MCP_WRITE_TOOLS.has(params.name)
    ) {
      requiredScopes.add(MCP_WRITE_SCOPE);
    }
  }

  return requiredScopes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
