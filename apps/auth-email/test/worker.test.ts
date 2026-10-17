import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthEmailWorker, type EmailEnv } from "../src/worker";

const env: EmailEnv = {
  RESEND_API_KEY: "test-only",
  AUTH_EMAIL_FROM: "login@example.test",
  AUTH_EMAIL_MODE: "production",
  AUTH_EMAIL_ALLOWED_RECIPIENTS: "recipient@example.test",
};
const payload = {
  email: "recipient@example.test",
  otp: "012345",
  type: "sign-in",
  expiresIn: 300,
};
const request = (body: unknown = payload) =>
  new Request("https://auth-email.internal/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const accepted = () =>
  Promise.resolve(
    Response.json({ id: "00000000-0000-4000-8000-000000000001" }),
  );
afterEach(() => vi.useRealTimers());
describe("private OTP delivery", () => {
  it("awaits acceptance and sends only fixed sender and bounded OTP content", async () => {
    const fetcher = vi.fn(accepted);
    const result = await createAuthEmailWorker({ fetch: fetcher }).fetch(
      request(),
      env,
    );
    expect(result.status).toBe(204);
    const [url, options] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.redirect).toBe("error");
    expect(JSON.parse(String(options.body))).toEqual({
      from: env.AUTH_EMAIL_FROM,
      to: [payload.email],
      subject: "Your OpenMemory sign-in code",
      text: "Your OpenMemory sign-in code is 012345. It expires in 5 minutes. If you did not request this code, ignore this email.",
    });
    expect(await result.text()).toBe("");
  });
  it.each([
    { ...payload, otp: "12345" },
    { ...payload, expiresIn: 301 },
    { ...payload, type: "reset-password" },
    { ...payload, email: "other@example.test" },
    { ...payload, from: "attacker@example.test" },
    { ...payload, email: "a\r\nb@example.test" },
    "x".repeat(2049),
  ])("rejects invalid input without sending", async (body) => {
    const fetcher = vi.fn(accepted);
    expect(
      (
        await createAuthEmailWorker({ fetch: fetcher }).fetch(
          request(body),
          env,
        )
      ).ok,
    ).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    "RESEND_API_KEY",
    "AUTH_EMAIL_FROM",
    "AUTH_EMAIL_MODE",
    "AUTH_EMAIL_ALLOWED_RECIPIENTS",
  ])("fails closed for missing %s", async (key) => {
    const fetcher = vi.fn(accepted);
    expect(
      (
        await createAuthEmailWorker({ fetch: fetcher }).fetch(request(), {
          ...env,
          [key]: undefined,
        })
      ).status,
    ).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects other methods and paths", async () => {
    const worker = createAuthEmailWorker({ fetch: vi.fn(accepted) });
    expect(
      (await worker.fetch(new Request("https://auth-email.internal/send"), env))
        .status,
    ).toBe(405);
    expect(
      (
        await worker.fetch(
          new Request("https://auth-email.internal/other", { method: "POST" }),
          env,
        )
      ).status,
    ).toBe(404);
  });
  it.each([
    () =>
      Promise.resolve(new Response("private provider error", { status: 429 })),
    () => Promise.reject(new Error("private key")),
    () => Promise.resolve(Response.json({ id: "" })),
    () => Promise.resolve(Response.json({ id: "not-an-id" })),
    () => Promise.resolve(new Response("not json")),
  ])("hides provider failure and never retries", async (provider) => {
    const fetcher = vi.fn(provider);
    const response = await createAuthEmailWorker({ fetch: fetcher }).fetch(
      request(),
      env,
    );
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Delivery unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds even a fetch implementation that ignores abort", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const pending = createAuthEmailWorker({ fetch: fetcher }).fetch(
      request(),
      env,
    );
    await vi.advanceTimersByTimeAsync(10001);
    expect((await pending).status).toBe(502);
    expect(
      (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].signal
        ?.aborted,
    ).toBe(true);
  });
  it("requires staging budget and cutoff", async () => {
    const fetcher = vi.fn(accepted);
    expect(
      (
        await createAuthEmailWorker({ fetch: fetcher }).fetch(request(), {
          ...env,
          AUTH_EMAIL_MODE: "staging",
        })
      ).status,
    ).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe("staging boundaries", () => {
  const stage = (
    first: () => Promise<{ attempts: number } | null>,
  ): EmailEnv => ({
    ...env,
    AUTH_EMAIL_MODE: "staging",
    AUTH_EMAIL_RUN_ID: "approved-test",
    AUTH_EMAIL_RUN_EXPIRES_AT: "2026-10-18T00:00:00Z",
    SEND_BUDGET_DB: {
      prepare: () => ({
        bind() {
          return this;
        },
        first: first as never,
      }),
    },
  });
  it("reserves before sending and refuses exhaustion", async () => {
    const first = vi.fn(async () => null);
    const send = vi.fn(accepted);
    expect(
      (
        await createAuthEmailWorker({ fetch: send, now: () => 0 }).fetch(
          request(),
          stage(first),
        )
      ).status,
    ).toBe(429);
    expect(first).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });
  it("does not refund a failed provider attempt", async () => {
    const first = vi.fn(async () => ({ attempts: 1 }));
    const send = vi.fn(async () => new Response("failure", { status: 500 }));
    expect(
      (
        await createAuthEmailWorker({ fetch: send, now: () => 0 }).fetch(
          request(),
          stage(first),
        )
      ).status,
    ).toBe(502);
    expect(first).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });
  it("fails closed on budget database error", async () => {
    const send = vi.fn(accepted);
    expect(
      (
        await createAuthEmailWorker({ fetch: send, now: () => 0 }).fetch(
          request(),
          stage(async () => {
            throw Error("database");
          }),
        )
      ).status,
    ).toBe(502);
    expect(send).not.toHaveBeenCalled();
  });
  it("will not send after a reservation finishes past deadline", async () => {
    vi.useFakeTimers();
    let complete: (value: { attempts: number }) => void = () => {};
    const send = vi.fn(accepted);
    const result = createAuthEmailWorker({ fetch: send, now: () => 0 }).fetch(
      request(),
      stage(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      ),
    );
    await vi.advanceTimersByTimeAsync(10001);
    expect((await result).status).toBe(502);
    complete({ attempts: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    () => new Response("x".repeat(4097)),
    () => new Response(new ReadableStream({ start() {} })),
  ])("bounds provider response bodies", async (makeResponse) => {
    vi.useFakeTimers();
    const result = createAuthEmailWorker({
      fetch: async () => makeResponse(),
    }).fetch(request(), env);
    await vi.advanceTimersByTimeAsync(10001);
    expect((await result).status).toBe(502);
  });
});
