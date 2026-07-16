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

  test("updates account profile through the typed RPC surface", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const api = createOpenMemoryClient("https://api.openmemory.test", {
      fetch: fakeFetch(async (input, init) => {
        const request = new Request(input, init);
        requests.push({
          url: request.url,
          method: request.method,
          body: await request.json(),
        });

        return Response.json({
          user: {
            id: "usr_1",
            email: "owner@example.com",
            name: "Research Lead",
          },
          workspace: {
            id: "wrk_1",
            name: "Research",
            tenantId: "usr_1",
            ownerUserId: "usr_1",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
          members: [],
        });
      }),
    });

    const account = await api.updateAccountProfile("Research Lead");

    expect(account.user.name).toBe("Research Lead");
    expect(requests).toEqual([
      {
        url: "https://api.openmemory.test/v1/account/profile",
        method: "PATCH",
        body: { name: "Research Lead" },
      },
    ]);
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
