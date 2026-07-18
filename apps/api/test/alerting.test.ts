import { describe, expect, test, vi } from "vitest";
import { runScheduledHealthMonitor } from "../src/alerting";
import type { Env } from "../src/env";

describe("scheduled health monitor", () => {
  test("reports healthy checks without sending notifications", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return Response.json({ ok: true, service: "openmemory-api" });
      }
      return Response.json({
        resource: "https://openmemory.test/mcp",
        authorization_servers: [
          "https://openmemory.test/.well-known/oauth-authorization-server/api/auth",
        ],
      });
    });

    const result = await runScheduledHealthMonitor(
      { OPENMEMORY_BASE_URL: "https://openmemory.test" } as Env,
      { fetch: fetcher as typeof fetch },
    );

    expect(result.status).toBe("healthy");
    expect(result.checks).toHaveLength(2);
    expect(result.checks.every((check) => check.ok)).toBe(true);
    expect(result.notification).toEqual({
      attempted: false,
      destinations: [],
      sent: false,
    });
  });

  test("sends configured webhook on failed checks", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          return Response.json(
            { ok: false, service: "openmemory-api" },
            { status: 503 },
          );
        }
        if (url === "https://alerts.example.com/openmemory") {
          expect(init?.method).toBe("POST");
          expect(init?.headers).toMatchObject({
            authorization: "Bearer alert-token",
            "content-type": "application/json",
          });
          const body = JSON.parse(String(init?.body)) as {
            event: string;
            failedChecks: unknown[];
          };
          expect(body.event).toBe("openmemory.scheduled_health_failed");
          expect(body.failedChecks).toHaveLength(1);
          return Response.json({ ok: true });
        }
        return Response.json({
          resource: "https://openmemory.test/mcp",
          authorization_servers: [
            "https://openmemory.test/.well-known/oauth-authorization-server/api/auth",
          ],
        });
      },
    );

    const result = await runScheduledHealthMonitor(
      {
        OPENMEMORY_BASE_URL: "https://openmemory.test",
        OPENMEMORY_ALERT_WEBHOOK_URL: "https://alerts.example.com/openmemory",
        OPENMEMORY_ALERT_WEBHOOK_TOKEN: "alert-token",
      } as Env,
      { fetch: fetcher as typeof fetch },
    );

    expect(result.status).toBe("unhealthy");
    expect(result.notification).toMatchObject({
      attempted: true,
      destinations: ["webhook"],
      sent: true,
    });
  });

  test("records unhealthy checks when no destination is configured", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: "down" }, { status: 500 }),
    );

    const result = await runScheduledHealthMonitor(
      { OPENMEMORY_BASE_URL: "https://openmemory.test" } as Env,
      { fetch: fetcher as typeof fetch },
    );

    expect(result.status).toBe("unhealthy");
    expect(result.notification).toEqual({
      attempted: false,
      destinations: [],
      sent: false,
    });
    expect(result.checks.every((check) => !check.ok)).toBe(true);
  });
});
