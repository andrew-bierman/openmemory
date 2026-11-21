import { describe, expect, it, vi } from "vitest";
import {
  qualifyStaging,
  STAGING_ORIGIN,
  type StagingApproval,
} from "../../../scripts/staging-qualification";

const now = 1_800_000_000_000;
const fixtures = ["a", "b", "c"].map((id) => ({
  email: `${id}@example.test`,
  userId: id,
  tenantId: `tenant-${id}`,
}));
const approval = (): StagingApproval => ({
  approved: true,
  runId: "om-qual-20261017-otp-1",
  origin: STAGING_ORIGIN,
  startAt: now,
  cutoffAt: now + 60_000,
  fixtures: fixtures.map((fixture) => ({ ...fixture })),
  maxRequests: 240,
  maxSends: 12,
});
function setup(
  overrides: { mismatch?: boolean; redirect?: boolean; fail?: boolean } = {},
) {
  const calls: Request[] = [];
  let current = fixtures[0] as (typeof fixtures)[number];
  return {
    calls,
    dependencies: {
      now: () => now,
      readOtp: async () => "123456",
      fetch: async (request: Request) => {
        calls.push(request);
        if (overrides.fail)
          throw new Error("secret-code-123456 cookie=private");
        if (overrides.redirect)
          return new Response(null, {
            status: 302,
            headers: { location: "https://evil.test" },
          });
        const path = new URL(request.url).pathname;
        if (path.endsWith("send-verification-otp"))
          return Response.json({ success: true });
        if (path.endsWith("sign-in/email-otp")) {
          const body = (await request.json()) as { email: string };
          const found = fixtures.find(
            (fixture) => fixture.email === body.email,
          );
          if (!found) throw new Error("Unexpected fixture");
          current = found;
          return Response.json(
            { token: "secret-token" },
            {
              headers: {
                "set-cookie":
                  "__Secure-better-auth.session_token=private; Secure; HttpOnly; Path=/",
              },
            },
          );
        }
        if (path === "/api/auth/get-session")
          return Response.json({
            user: { id: current.userId, email: current.email },
          });
        if (path === "/v1/account")
          return Response.json({
            user: { id: current.userId, email: current.email },
            workspace: {
              tenantId: overrides.mismatch ? "other" : current.tenantId,
            },
          });
        if (path === "/v1/readiness")
          return Response.json({ tenant: { id: current.tenantId }, ok: true });
        return Response.json({
          resource: `${STAGING_ORIGIN}/mcp`,
          authorization_servers: [
            `${STAGING_ORIGIN}/.well-known/oauth-authorization-server/api/auth`,
          ],
        });
      },
    },
  };
}
describe("bounded staging qualification", () => {
  it("qualifies three OTP identities with fixed reads and sanitized evidence", async () => {
    const { calls, dependencies } = setup();
    const result = await qualifyStaging(approval(), dependencies);
    expect(result).toMatchObject({
      ok: true,
      requests: 16,
      sends: 3,
      verifiedFixtures: 3,
    });
    expect(
      calls.every(
        (request) =>
          request.method !== "DELETE" &&
          request.redirect === "manual" &&
          new URL(request.url).origin === STAGING_ORIGIN,
      ),
    ).toBe(true);
    expect(
      calls
        .filter((request) => request.method === "POST")
        .map((request) => new URL(request.url).pathname),
    ).toEqual(
      fixtures.flatMap(() => [
        "/api/auth/email-otp/send-verification-otp",
        "/api/auth/sign-in/email-otp",
      ]),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /123456|private|secret-token|example.test/,
    );
  });
  it.each([
    "approval",
    "origin",
    "window",
    "fixtures",
  ])("rejects invalid %s before traffic", async (kind) => {
    const config = approval();
    if (kind === "approval") config.approved = false;
    if (kind === "origin") config.origin = "https://evil.test";
    if (kind === "window") config.cutoffAt = now + 46 * 60_000;
    if (kind === "fixtures")
      config.fixtures[1] = {
        email: "a@example.test",
        userId: "a",
        tenantId: "tenant-a",
      };
    const { calls, dependencies } = setup();
    expect((await qualifyStaging(config, dependencies)).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it("stops on identity mismatch before readiness or subsequent sends", async () => {
    const { calls, dependencies } = setup({ mismatch: true });
    expect(await qualifyStaging(approval(), dependencies)).toMatchObject({
      ok: false,
      error: "identity_mismatch",
      requests: 4,
      sends: 1,
    });
    expect(calls).toHaveLength(4);
  });
  it("rejects redirects and never follows them", async () => {
    const { calls, dependencies } = setup({ redirect: true });
    expect(await qualifyStaging(approval(), dependencies)).toMatchObject({
      error: "redirect_rejected",
    });
    expect(calls).toHaveLength(1);
  });
  it("counts failed sends and sanitizes transport errors", async () => {
    const { dependencies } = setup({ fail: true });
    const result = await qualifyStaging(approval(), dependencies);
    expect(result).toMatchObject({
      error: "transport_failed",
      requests: 1,
      sends: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(/123456|cookie|private/);
  });
  it("stops at its request budget without retry or cleanup", async () => {
    const config = { ...approval(), maxRequests: 2 };
    const { calls, dependencies } = setup();
    expect(await qualifyStaging(config, dependencies)).toMatchObject({
      error: "request_budget",
      requests: 2,
    });
    expect(calls).toHaveLength(2);
  });
  it("stops at its send budget", async () => {
    const { calls, dependencies } = setup();
    expect(
      await qualifyStaging({ ...approval(), maxSends: 1 }, dependencies),
    ).toMatchObject({ error: "send_budget", sends: 1 });
    expect(calls).toHaveLength(5);
  });
  it("rechecks cutoff after waiting for the mailbox", async () => {
    const { calls, dependencies } = setup();
    let time = now;
    dependencies.now = () => time;
    dependencies.readOtp = async () => {
      time = now + 60_001;
      return "123456";
    };
    expect(await qualifyStaging(approval(), dependencies)).toMatchObject({
      error: "cutoff",
      sends: 1,
      requests: 1,
    });
    expect(calls).toHaveLength(1);
  });
  it.each([
    { maxRequests: 241 },
    { maxSends: 13 },
  ])("rejects enlarged budgets", async (budget) => {
    const { calls, dependencies } = setup();
    expect(
      await qualifyStaging({ ...approval(), ...budget }, dependencies),
    ).toMatchObject({ error: "invalid_approval" });
    expect(calls).toHaveLength(0);
  });
  it("does not submit malformed OTPs or echo their contents", async () => {
    const { calls, dependencies } = setup();
    dependencies.readOtp = async () => "private-code";
    const result = await qualifyStaging(approval(), dependencies);
    expect(result).toMatchObject({ error: "otp_failed", requests: 1 });
    expect(JSON.stringify(result)).not.toContain("private-code");
    expect(calls).toHaveLength(1);
  });
  it("bounds a stalled transport and aborts without retry", async () => {
    vi.useFakeTimers();
    try {
      const { dependencies } = setup();
      let signal: AbortSignal | undefined;
      dependencies.fetch = async (request: Request) => {
        signal = request.signal;
        return new Promise<Response>(() => {});
      };
      const pending = qualifyStaging(approval(), dependencies);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toMatchObject({
        error: "transport_failed",
        requests: 1,
        sends: 1,
      });
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects a wrong session before reading the account", async () => {
    const { calls, dependencies } = setup();
    const original = dependencies.fetch;
    dependencies.fetch = async (request) =>
      new URL(request.url).pathname === "/api/auth/get-session"
        ? Response.json({ user: { id: "other", email: "other@example.test" } })
        : original(request);
    expect(await qualifyStaging(approval(), dependencies)).toMatchObject({
      error: "identity_mismatch",
      requests: 3,
    });
    expect(
      calls.some((request) => new URL(request.url).pathname === "/v1/account"),
    ).toBe(false);
  });
  it("rejects oversized response bodies without leaking content", async () => {
    const { dependencies } = setup();
    const original = dependencies.fetch;
    dependencies.fetch = async (request) =>
      new URL(request.url).pathname === "/api/auth/get-session"
        ? Response.json({ secret: "sensitive".repeat(10_000) })
        : original(request);
    const result = await qualifyStaging(approval(), dependencies);
    expect(result).toMatchObject({ error: "invalid_response", requests: 3 });
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });
});
