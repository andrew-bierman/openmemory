import { describe, expect, test } from "vitest";
import type { Env } from "../src/env";
import {
  checkGlobalRateLimit,
  checkRateLimit,
  jsonResponse,
} from "../src/operational-controls";

describe("operational controls", () => {
  test("applies configurable per-key request limits", () => {
    const env = {
      EMBEDDING_MODEL: "@cf/test/embedding",
      OPENMEMORY_RATE_LIMIT_PER_MINUTE: "2",
    } as unknown as Env;
    const request = new Request("https://openmemory.test/v1/memories", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        "x-openmemory-user-id": "tenant-a",
      },
    });

    expect(checkRateLimit(request, env, 1_000)).toMatchObject({
      limited: false,
      remaining: 1,
      scope: "isolate",
    });
    expect(checkRateLimit(request, env, 2_000)).toMatchObject({
      limited: false,
      remaining: 0,
    });
    expect(checkRateLimit(request, env, 3_000)).toMatchObject({
      limited: true,
      remaining: 0,
      retryAfterSeconds: 58,
    });
    expect(checkRateLimit(request, env, 62_000)).toMatchObject({
      limited: false,
      remaining: 1,
    });
  });

  test("skips request limits when disabled", () => {
    const env = {
      EMBEDDING_MODEL: "@cf/test/embedding",
      OPENMEMORY_RATE_LIMIT_ENABLED: "false",
      OPENMEMORY_RATE_LIMIT_PER_MINUTE: "1",
    } as unknown as Env;
    const request = new Request("https://openmemory.test/health");

    const first = checkRateLimit(request, env, 1_000);
    expect(first).toMatchObject({
      enabled: false,
      limited: false,
      remaining: 1,
      scope: "disabled",
    });
    expect(first.headers).toEqual({});
    expect(checkRateLimit(request, env, 2_000)).toMatchObject({
      enabled: false,
      limited: false,
      remaining: 1,
    });
  });

  test("does not trust spoofable tenant headers for the request bucket", () => {
    const env = {
      EMBEDDING_MODEL: "@cf/test/embedding",
      OPENMEMORY_RATE_LIMIT_PER_MINUTE: "1",
    } as unknown as Env;

    const first = new Request("https://openmemory.test/v1/memories", {
      headers: {
        authorization: "Bearer shared-token",
        "cf-connecting-ip": "203.0.113.55",
        "x-openmemory-user-id": "tenant-a",
      },
    });
    const second = new Request("https://openmemory.test/v1/memories", {
      headers: {
        authorization: "Bearer shared-token",
        "cf-connecting-ip": "203.0.113.55",
        "x-openmemory-user-id": "tenant-b",
      },
    });

    expect(checkRateLimit(first, env, 10_000)).toMatchObject({
      limited: false,
      remaining: 0,
    });
    expect(checkRateLimit(second, env, 11_000)).toMatchObject({
      limited: true,
      remaining: 0,
    });
  });

  test("uses global limiter binding without incrementing isolate fallback", async () => {
    const env = {
      EMBEDDING_MODEL: "@cf/test/embedding",
      OPENMEMORY_RATE_LIMIT_PER_MINUTE: "1",
      MEMORY_GRAPHS: {
        idFromName: (name: string) => name,
        get: () => ({
          checkRateLimit: async () => ({
            enabled: true,
            headers: { "x-ratelimit-scope": "global" },
            limit: 1,
            limited: false,
            remaining: 0,
            retryAfterSeconds: 60,
            scope: "global" as const,
          }),
        }),
      },
    } as unknown as Env;
    const request = new Request("https://openmemory.test/v1/memories", {
      headers: {
        authorization: "Bearer global-binding-test",
        "cf-connecting-ip": "203.0.113.80",
      },
    });

    await expect(
      checkGlobalRateLimit(request, env, 20_000),
    ).resolves.toMatchObject({
      scope: "global",
      limited: false,
    });
    expect(checkRateLimit(request, env, 21_000)).toMatchObject({
      scope: "isolate",
      limited: false,
      remaining: 0,
    });
  });

  test("json responses always advertise JSON content", async () => {
    const response = jsonResponse({ ok: true }, { status: 202 });

    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
