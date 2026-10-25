/** Import-safe, non-deleting staging scenario. No environment reads or CLI entrypoint. */
export const STAGING_ORIGIN =
  "https://om-qual-20261017-api.abbierman101.workers.dev";
export type StagingFixture = {
  email: string;
  userId: string;
  tenantId: string;
};
export type StagingApproval = {
  approved: boolean;
  runId: "om-qual-20261017-otp-1";
  origin: string;
  startAt: number;
  cutoffAt: number;
  fixtures: StagingFixture[];
  maxRequests: number;
  maxSends: number;
};
export type StagingDependencies = {
  fetch: (request: Request) => Promise<Response>;
  now: () => number;
  /** Controlled mailbox integration must not log the OTP or inspect unrelated mail. */
  readOtp: (
    fixture: Readonly<StagingFixture>,
    signal: AbortSignal,
  ) => Promise<string>;
};
type Failure =
  | "invalid_approval"
  | "cutoff"
  | "request_budget"
  | "send_budget"
  | "send_pacing"
  | "redirect_rejected"
  | "transport_failed"
  | "http_failed"
  | "invalid_response"
  | "identity_mismatch"
  | "otp_failed";
export type StagingEvidence = {
  ok: boolean;
  scope: "http-otp-identity-readiness-mcp-discovery";
  requests: number;
  sends: number;
  verifiedFixtures: number;
  error?: Failure;
};
class Stop extends Error {
  constructor(readonly code: Failure) {
    super(code);
  }
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
const emailPattern =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

export async function qualifyStaging(
  input: StagingApproval,
  dependencies: StagingDependencies,
): Promise<StagingEvidence> {
  const evidence: StagingEvidence = {
    ok: false,
    scope: "http-otp-identity-readiness-mcp-discovery",
    requests: 0,
    sends: 0,
    verifiedFixtures: 0,
  };
  // Snapshot the approved scope before awaiting externally supplied dependencies.
  const approval = {
    ...input,
    fixtures: input.fixtures.map((fixture) => ({ ...fixture })),
  };
  const sendTimes: { email: string; at: number }[] = [];
  const checkTime = () => {
    const now = dependencies.now();
    if (
      !Number.isFinite(now) ||
      now < approval.startAt ||
      now >= approval.cutoffAt
    )
      throw new Stop("cutoff");
    return now;
  };
  async function bounded<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    limit: number,
    code: Failure,
  ): Promise<T> {
    const duration = Math.min(limit, approval.cutoffAt - checkTime());
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Stop(code));
          }, duration);
        }),
        operation(controller.signal),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function request(
    path: string,
    cookie?: string,
    body?: { email: string; type: "sign-in" } | { email: string; otp: string },
  ): Promise<Response> {
    checkTime();
    if (evidence.requests >= approval.maxRequests)
      throw new Stop("request_budget");
    evidence.requests++;
    const headers = new Headers();
    if (cookie) headers.set("cookie", cookie);
    if (body) headers.set("content-type", "application/json");
    let response: Response;
    try {
      response = await bounded(
        (signal) =>
          dependencies.fetch(
            new Request(`${STAGING_ORIGIN}${path}`, {
              method: body ? "POST" : "GET",
              headers,
              body: body ? JSON.stringify(body) : undefined,
              redirect: "manual",
              signal,
            }),
          ),
        10_000,
        "transport_failed",
      );
    } catch {
      throw new Stop("transport_failed");
    }
    checkTime();
    if (
      response.redirected ||
      (response.status >= 300 && response.status < 400) ||
      (response.url && new URL(response.url).origin !== STAGING_ORIGIN)
    ) {
      void response.body?.cancel().catch(() => {});
      throw new Stop("redirect_rejected");
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new Stop("http_failed");
    }
    return response;
  }
  async function json(response: Response): Promise<Record<string, unknown>> {
    const reader = response.body?.getReader();
    if (!reader) throw new Stop("invalid_response");
    try {
      return await bounded(
        async () => {
          const decoder = new TextDecoder();
          let bytes = 0;
          let text = "";
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 65_536) throw new Stop("invalid_response");
            text += decoder.decode(chunk.value, { stream: true });
          }
          return object(JSON.parse(text + decoder.decode()));
        },
        10_000,
        "invalid_response",
      );
    } catch {
      throw new Stop("invalid_response");
    } finally {
      void reader.cancel().catch(() => {});
    }
  }

  try {
    if (
      !approval.approved ||
      approval.runId !== "om-qual-20261017-otp-1" ||
      approval.origin !== STAGING_ORIGIN ||
      !Number.isFinite(approval.startAt) ||
      !Number.isFinite(approval.cutoffAt) ||
      approval.cutoffAt <= approval.startAt ||
      approval.cutoffAt - approval.startAt > 45 * 60_000 ||
      !Number.isInteger(approval.maxRequests) ||
      approval.maxRequests < 1 ||
      approval.maxRequests > 240 ||
      !Number.isInteger(approval.maxSends) ||
      approval.maxSends < 1 ||
      approval.maxSends > 12 ||
      approval.fixtures.length !== 3 ||
      approval.fixtures.some(
        (fixture) =>
          !emailPattern.test(fixture.email) ||
          fixture.email.length > 254 ||
          !fixture.userId ||
          !fixture.tenantId,
      ) ||
      ["email", "userId", "tenantId"].some(
        (field) =>
          new Set(
            approval.fixtures.map(
              (fixture) => fixture[field as keyof StagingFixture],
            ),
          ).size !== 3,
      )
    )
      throw new Stop("invalid_approval");
    checkTime();
    for (const fixture of approval.fixtures) {
      const now = checkTime();
      if (evidence.sends >= approval.maxSends) throw new Stop("send_budget");
      const recent = sendTimes.filter((sent) => sent.at > now - 15 * 60_000);
      if (
        recent.length >= 10 ||
        recent.filter((sent) => sent.email === fixture.email).length >= 3
      )
        throw new Stop("send_pacing");
      // Count attempted sends before network I/O; ambiguous outcomes are never retried.
      evidence.sends++;
      sendTimes.push({ email: fixture.email, at: now });
      const sent = await request(
        "/api/auth/email-otp/send-verification-otp",
        undefined,
        {
          email: fixture.email,
          type: "sign-in",
        },
      );
      void sent.body?.cancel().catch(() => {});
      let otp: string;
      try {
        otp = await bounded(
          (signal) =>
            dependencies.readOtp(Object.freeze({ ...fixture }), signal),
          120_000,
          "otp_failed",
        );
      } catch {
        throw new Stop("otp_failed");
      }
      checkTime();
      if (!/^\d{6}$/.test(otp)) throw new Stop("otp_failed");
      const login = await request("/api/auth/sign-in/email-otp", undefined, {
        email: fixture.email,
        otp,
      });
      void login.body?.cancel().catch(() => {});
      const cookie = login.headers
        .getSetCookie()
        .map((value) => value.split(";")[0] ?? "")
        .find((value) =>
          /^__Secure-better-auth\.session_token=[^\s;,]+$/.test(value),
        );
      if (!cookie) throw new Stop("invalid_response");
      const session = await json(
        await request("/api/auth/get-session", cookie),
      );
      if (
        object(session.user).id !== fixture.userId ||
        object(session.user).email !== fixture.email
      )
        throw new Stop("identity_mismatch");
      const account = await json(await request("/v1/account", cookie));
      if (
        object(account.user).id !== fixture.userId ||
        object(account.user).email !== fixture.email ||
        object(account.workspace).tenantId !== fixture.tenantId
      )
        throw new Stop("identity_mismatch");
      const readiness = await json(await request("/v1/readiness", cookie));
      if (object(readiness.tenant).id !== fixture.tenantId)
        throw new Stop("identity_mismatch");
      evidence.verifiedFixtures++;
    }
    const discovery = await json(
      await request("/.well-known/oauth-protected-resource/mcp"),
    );
    if (
      discovery.resource !== `${STAGING_ORIGIN}/mcp` ||
      !Array.isArray(discovery.authorization_servers) ||
      discovery.authorization_servers.length !== 1 ||
      discovery.authorization_servers[0] !==
        `${STAGING_ORIGIN}/.well-known/oauth-authorization-server/api/auth`
    )
      throw new Stop("invalid_response");
    checkTime();
    evidence.ok = true;
  } catch (error) {
    evidence.error = error instanceof Stop ? error.code : "invalid_response";
  }
  return evidence;
}
