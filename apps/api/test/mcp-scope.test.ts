import { describe, expect, test } from "vitest";
import {
  getRequiredMcpScopesForPayload,
  getRequiredMcpScopesForRequest,
} from "../src/mcp-scopes";

describe("MCP OAuth scope requirements", () => {
  test("requires read scope for discovery and read surfaces", () => {
    for (const payload of [
      { jsonrpc: "2.0", id: "tools", method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: "recall",
        method: "tools/call",
        params: { name: "recall", arguments: { query: "launch" } },
      },
      {
        jsonrpc: "2.0",
        id: "profile",
        method: "tools/call",
        params: { name: "profile", arguments: {} },
      },
      {
        jsonrpc: "2.0",
        id: "resource",
        method: "resources/read",
        params: { uri: "openmemory://profile" },
      },
      {
        jsonrpc: "2.0",
        id: "prompt",
        method: "prompts/get",
        params: { name: "context" },
      },
    ]) {
      expect([...getRequiredMcpScopesForPayload(payload)]).toEqual([
        "memory:read",
      ]);
    }
  });

  test("requires write scope for memory-changing tools", () => {
    for (const name of ["remember", "forget"]) {
      expect([
        ...getRequiredMcpScopesForPayload({
          jsonrpc: "2.0",
          id: name,
          method: "tools/call",
          params: { name, arguments: {} },
        }),
      ]).toEqual(["memory:read", "memory:write"]);
    }
  });

  test("requires write scope when any batched call writes", () => {
    expect([
      ...getRequiredMcpScopesForPayload([
        {
          jsonrpc: "2.0",
          id: "recall",
          method: "tools/call",
          params: { name: "recall", arguments: { query: "mcp" } },
        },
        {
          jsonrpc: "2.0",
          id: "remember",
          method: "tools/call",
          params: {
            name: "remember",
            arguments: { content: "MCP writes need write scope." },
          },
        },
      ]),
    ]).toEqual(["memory:read", "memory:write"]);
  });

  test("falls back to read scope for malformed request bodies", async () => {
    const request = new Request("https://example.com/mcp", {
      method: "POST",
      body: "{",
      headers: { "content-type": "application/json" },
    });

    expect([...(await getRequiredMcpScopesForRequest(request))]).toEqual([
      "memory:read",
    ]);
  });
});
