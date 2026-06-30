import { describe, expect, test } from "vitest";
import { createOpenMemoryClient } from ".";

describe("OpenMemory client", () => {
  test("sends tenant, bearer, and credential options through Eden fetch", async () => {
    const requests: Array<{
      url: string;
      headers: Record<string, string>;
      credentials?: RequestCredentials;
    }> = [];
    const api = createOpenMemoryClient("https://api.openmemory.test", {
      tenantId: "tenant-a",
      token: "token-a",
      credentials: "include",
      fetch: fakeFetch(async (input, init) => {
        const request = new Request(input, init);
        requests.push({
          url: request.url,
          headers: Object.fromEntries(request.headers.entries()),
          credentials: init?.credentials,
        });

        return Response.json([]);
      }),
    });

    await api.listMemories();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("/v1/memories");
    expect(requests[0]?.headers["x-openmemory-user-id"]).toBe("tenant-a");
    expect(requests[0]?.headers.authorization).toBe("Bearer token-a");
    expect(requests[0]?.credentials).toBe("include");
  });

  test("throws typed API errors for failed responses", async () => {
    const api = createOpenMemoryClient("https://api.openmemory.test", {
      fetch: fakeFetch(async () =>
        Response.json({ error: "missing_tenant" }, { status: 401 }),
      ),
    });

    await expect(api.listMemories()).rejects.toMatchObject({
      status: 401,
    });
  });
});

function fakeFetch(
  handler: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
) {
  return Object.assign(handler, { preconnect: fetch.preconnect });
}
