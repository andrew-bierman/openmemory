import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  createAuthEmailWorker,
  type EmailEnv,
} from "../../auth-email/src/worker";
import {
  createOpenMemoryAuth,
  handleOpenMemoryAuthRequest,
} from "../src/better-auth";
import type { Env } from "../src/env";

// Real local workerd-backed D1. Only the external email transport is replaced;
// it captures synthetic OTP deliveries and never sends email or logs codes.
const origin = "https://passwordless.openmemory.test";
const allowed =
  "alice@example.test,bob@example.test,unprovisioned@example.test";
let mf: {
  getD1Database(name: string): Promise<unknown>;
  dispose(): Promise<void>;
};
let db: NonNullable<Env["AUTH_DB"]>;
let deliveries: Array<{
  email: string;
  otp: string;
  type: string;
  expiresIn: number;
}>;
let deliveryStatus = 200;
function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error("Missing expected fixture value");
  return value;
}
function environment(overrides: Partial<Env> = {}): Env {
  return {
    AUTH_DB: db,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET:
      "local-test-passwordless-secret-with-sufficient-entropy",
    OPENMEMORY_AUTH_ALLOWED_EMAILS: allowed,
    AUTH_EMAIL: {
      fetch: async (request: Request) => {
        deliveries.push(await request.json());
        return new Response(null, { status: deliveryStatus });
      },
    },
    ...overrides,
  } as Env;
}
function request(path: string, body: unknown, ip = "192.0.2.1") {
  return new Request(`${origin}/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "cf-connecting-ip": ip,
    },
    body: JSON.stringify(body),
  });
}
async function post(
  path: string,
  body: unknown,
  options: { ip?: string; env?: Partial<Env> } = {},
) {
  const req = request(path, body, options.ip);
  // A new auth instance per request exercises durable state, not process-local counters.
  return createOpenMemoryAuth(environment(options.env), req).handler(req);
}
const send = (
  email = "alice@example.test",
  options: Parameters<typeof post>[2] = {},
) =>
  post("/email-otp/send-verification-otp", { email, type: "sign-in" }, options);
const verify = (
  otp: string,
  email = "alice@example.test",
  options: Parameters<typeof post>[2] = {},
) => post("/sign-in/email-otp", { email, otp }, options);
async function scalar(sql: string) {
  return db.prepare(sql).first();
}

beforeAll(async () => {
  // Keep Miniflare's unrelated ambient runtime declarations out of app tests.
  const moduleName = "miniflare";
  const { Miniflare } = await import(moduleName);
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch(){return new Response('local fixture')} }",
    d1Databases: ["AUTH_DB"],
  });
  db = (await mf.getD1Database("AUTH_DB")) as unknown as NonNullable<
    Env["AUTH_DB"]
  >;
  const directory = resolve(import.meta.dirname, "../drizzle");
  for (const name of (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(resolve(directory, name), "utf8");
    // D1 exec executes each physical line; preserve trigger bodies on one line.
    await db.exec(sql.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
  }
  const mailBudgetSql = await readFile(
    resolve(
      import.meta.dirname,
      "../../auth-email/migrations/0001_send_budget.sql",
    ),
    "utf8",
  );
  await db.exec(mailBudgetSql.replace(/\n/g, " "));
}, 30_000);
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  deliveries = [];
  deliveryStatus = 200;
  for (const table of [
    "session",
    "account",
    "oauth_access_token",
    "oauth_refresh_token",
    "oauth_consent",
    "oauth_client",
    "verification",
    "passwordless_otp",
    "passwordless_throttle",
    "send_budget",
    "user",
  ]) {
    await db.prepare(`DELETE FROM ${table}`).run();
  }
  for (const [id, email] of [
    ["existing-alice", "alice@example.test"],
    ["existing-bob", "bob@example.test"],
    ["outsider", "outsider@example.test"],
  ]) {
    await db
      .prepare(
        "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,unixepoch(),unixepoch())",
      )
      .bind(id, id, email)
      .run();
  }
});

describe("passwordless authentication against real D1", () => {
  test("blocks password creation, login, recovery and mutation over HTTP and direct API", async () => {
    await send();
    const login = await verify(required(deliveries[0]).otp);
    const cookie = required(
      required(login.headers.get("set-cookie")).split(";")[0],
    );
    const cases = [
      [
        "/sign-up/email",
        "signUpEmail",
        {
          email: "new@example.test",
          password: "Synthetic-password-123!",
          name: "New",
        },
      ],
      [
        "/sign-in/email",
        "signInEmail",
        { email: "alice@example.test", password: "Synthetic-password-123!" },
      ],
      [
        "/request-password-reset",
        "requestPasswordReset",
        { email: "alice@example.test" },
      ],
      [
        "/reset-password",
        "resetPassword",
        { token: "synthetic-token", newPassword: "Synthetic-password-123!" },
      ],
      [
        "/set-password",
        "setPassword",
        { newPassword: "Synthetic-password-123!" },
      ],
      [
        "/change-password",
        "changePassword",
        {
          currentPassword: "old-password",
          newPassword: "Synthetic-password-123!",
        },
      ],
    ] as const;
    for (const [path, method, body] of cases) {
      expect((await post(path, body)).status, path).toBe(
        path === "/set-password" ? 404 : 403,
      );
      const req = request(path, body);
      req.headers.set("cookie", cookie);
      const auth = createOpenMemoryAuth(environment(), req);
      const api = auth.api as unknown as Record<
        string,
        (input: unknown) => Promise<unknown>
      >;
      expect(api[method], method).toBeTypeOf("function");
      await expect(
        required(api[method])({ body, headers: req.headers }),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(await scalar("SELECT count(*) AS n FROM account")).toEqual({ n: 0 });
  });

  test("sends generic responses, never signs up implicitly, denies uninvited existing users", async () => {
    const accepted = await send();
    expect(accepted.status).toBe(200);
    const generic = await accepted.json();
    for (const email of [
      "outsider@example.test",
      "unknown@example.test",
      "unprovisioned@example.test",
    ]) {
      const response = await send(email);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(generic);
      expect((await verify("000000", email)).status).toBe(400);
    }
    expect(deliveries).toHaveLength(1);
    expect(await scalar("SELECT count(*) AS n FROM user")).toEqual({ n: 3 });
  });

  test("hashes a short-lived code, consumes it once and preserves the original identity and credentials", async () => {
    await db
      .prepare(
        "INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES('credential-alice','existing-alice','credential','existing-alice','existing-password-hash',unixepoch(),unixepoch())",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO oauth_consent(id,client_id,user_id,scopes,created_at,updated_at) VALUES('grant-alice','mcp-client','existing-alice','memory:read',unixepoch(),unixepoch())",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO workspace VALUES('workspace-alice','existing-alice','Existing team',unixepoch(),unixepoch())",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO workspace_member(id,workspace_id,user_id,email,role,status,created_at,updated_at,accepted_at) VALUES('membership-alice','workspace-alice','existing-alice','alice@example.test','owner','active',unixepoch(),unixepoch(),unixepoch())",
      )
      .run();
    const grant = await scalar(
      "SELECT * FROM oauth_consent WHERE id='grant-alice'",
    );
    const membership = await scalar(
      "SELECT * FROM workspace_member WHERE id='membership-alice'",
    );
    expect((await send()).status).toBe(200);
    expect(deliveries).toHaveLength(1);
    const sent = required(deliveries[0]);
    expect(sent.otp).toMatch(/^\d{6}$/);
    expect(sent.type).toBe("sign-in");
    expect(sent.expiresIn).toBe(300);
    const stored = await scalar(
      "SELECT * FROM passwordless_otp WHERE email='alice@example.test'",
    );
    expect(stored?.hash).not.toBe(sent.otp);
    expect(stored?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toHaveProperty("otp");
    expect(Number(stored?.expires_at) - Date.now()).toBeGreaterThan(290_000);
    expect(Number(stored?.expires_at) - Date.now()).toBeLessThanOrEqual(
      300_000,
    );
    const response = await verify(sent.otp);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { id: "existing-alice", email: "alice@example.test" },
    });
    expect(response.headers.get("set-cookie")).toContain("session_token");
    expect((await verify(sent.otp)).status).toBe(400);
    expect(await scalar("SELECT count(*) AS n FROM passwordless_otp")).toEqual({
      n: 0,
    });
    expect(
      await scalar("SELECT password FROM account WHERE id='credential-alice'"),
    ).toEqual({ password: "existing-password-hash" });
    expect(
      await scalar("SELECT * FROM oauth_consent WHERE id='grant-alice'"),
    ).toEqual(grant);
    expect(
      await scalar(
        "SELECT * FROM workspace_member WHERE id='membership-alice'",
      ),
    ).toEqual(membership);
  });

  test("concurrent verification across auth instances creates exactly one session", async () => {
    await send();
    const results = await Promise.all([
      verify(required(deliveries[0]).otp),
      verify(required(deliveries[0]).otp),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await scalar("SELECT count(*) AS n FROM session")).toEqual({ n: 1 });
  });

  test("expired codes cannot create sessions", async () => {
    await send();
    await db.prepare("UPDATE passwordless_otp SET expires_at=0").run();
    expect((await verify(required(deliveries[0]).otp)).status).toBe(400);
    expect(await scalar("SELECT count(*) AS n FROM session")).toEqual({ n: 0 });
  });

  test("delivery absent or failing fails closed", async () => {
    expect(
      (await send("alice@example.test", { env: { AUTH_EMAIL: undefined } }))
        .status,
    ).toBe(503);
    expect(deliveries).toHaveLength(0);
    for (const missing of [
      { AUTH_DB: undefined },
      { BETTER_AUTH_SECRET: undefined },
      { OPENMEMORY_AUTH_ALLOWED_EMAILS: "" },
    ]) {
      expect((await send("alice@example.test", { env: missing })).status).toBe(
        503,
      );
    }
    deliveryStatus = 503;
    const failedDelivery = await send();
    const unknownRecipient = await send("unknown@example.test", {
      ip: "192.0.2.2",
    });
    expect(failedDelivery.status).toBe(unknownRecipient.status);
    expect(await failedDelivery.json()).toEqual(await unknownRecipient.json());
    expect((await verify(required(deliveries[0]).otp)).status).not.toBe(200);
    expect(await scalar("SELECT count(*) AS n FROM session")).toEqual({ n: 0 });
  });

  test("email send limits survive new instances and changing client IP", async () => {
    for (let i = 0; i < 3; i++)
      expect(
        (await send("alice@example.test", { ip: `192.0.2.${i + 1}` })).status,
      ).toBe(200);
    expect(
      (await send("alice@example.test", { ip: "192.0.2.99" })).status,
    ).toBe(429);
    expect(deliveries).toHaveLength(3);
  });

  test("IP send limits cover changing email addresses, including denied identities", async () => {
    for (let i = 0; i < 10; i++)
      expect((await send(`unknown${i}@example.test`)).status).toBe(200);
    expect((await send("another@example.test")).status).toBe(429);
    expect(deliveries).toHaveLength(0);
  });

  test("verification attempts are durably bounded per email even when IP changes", async () => {
    await send();
    const otp = required(deliveries[0]).otp;
    const wrong = otp === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++)
      expect(
        (await verify(wrong, "alice@example.test", { ip: `192.0.2.${i + 1}` }))
          .status,
      ).toBe(400);
    expect(
      (await verify(otp, "alice@example.test", { ip: "192.0.2.99" })).status,
    ).toBe(429);
    expect(await scalar("SELECT count(*) AS n FROM session")).toEqual({ n: 0 });
  });

  test("verification IP limits cover rotating identities", async () => {
    for (let i = 0; i < 30; i++)
      expect((await verify("000000", `unknown${i}@example.test`)).status).toBe(
        400,
      );
    expect((await verify("000000", "another@example.test")).status).toBe(429);
  });

  test("direct auth.api sends and verifies share durable HTTP budgets", async () => {
    const body = { email: "alice@example.test", type: "sign-in" };
    for (let i = 0; i < 3; i++) {
      const req = request("/email-otp/send-verification-otp", body);
      const api = createOpenMemoryAuth(environment(), req)
        .api as unknown as Record<string, (input: unknown) => Promise<unknown>>;
      await required(api.sendVerificationOTP)({ body, headers: req.headers });
    }
    expect((await send()).status).toBe(429);
    const otp = required(deliveries.at(-1)).otp;
    const req = request("/sign-in/email-otp", {
      email: "alice@example.test",
      otp,
    });
    const api = createOpenMemoryAuth(environment(), req)
      .api as unknown as Record<string, (input: unknown) => Promise<unknown>>;
    await required(api.signInEmailOTP)({
      body: { email: "alice@example.test", otp },
      headers: req.headers,
    });
    expect((await verify(otp)).status).toBe(400);
  });
  test("revoked invitations invalidate existing session reads, including direct API", async () => {
    await send();
    const login = await verify(required(deliveries[0]).otp);
    const cookie = required(
      required(login.headers.get("set-cookie")).split(";")[0],
    );
    const req = new Request(`${origin}/api/auth/get-session`, {
      headers: { cookie },
    });
    const env = environment({
      OPENMEMORY_AUTH_ALLOWED_EMAILS: "bob@example.test",
    });
    expect((await createOpenMemoryAuth(env, req).handler(req)).status).toBe(
      403,
    );
    await expect(
      createOpenMemoryAuth(env, req).api.getSession({ headers: req.headers }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test("configuration capabilities expose only fully configured social providers", async () => {
    const req = new Request(`${origin}/api/auth/capabilities`);
    const response = await handleOpenMemoryAuthRequest(environment(), req);
    expect(await response.json()).toEqual({
      emailOTP: true,
      socialProviders: [],
    });
    const partial = await handleOpenMemoryAuthRequest(
      environment({ GITHUB_CLIENT_ID: "synthetic-client" }),
      req,
    );
    expect(await partial.json()).toMatchObject({ socialProviders: [] });
    const configured = await handleOpenMemoryAuthRequest(
      environment({
        GITHUB_CLIENT_ID: "synthetic-client",
        GITHUB_CLIENT_SECRET: "synthetic-secret",
      }),
      req,
    );
    expect(await configured.json()).toMatchObject({
      socialProviders: ["github"],
    });
    expect(
      (
        await post("/sign-in/social", {
          provider: "google",
          callbackURL: origin,
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    for (const missing of [
      { AUTH_EMAIL: undefined },
      { BETTER_AUTH_SECRET: undefined },
      { OPENMEMORY_AUTH_ALLOWED_EMAILS: "" },
    ]) {
      const disabled = await handleOpenMemoryAuthRequest(
        environment(missing),
        req,
      );
      expect(await disabled.json()).toMatchObject({ emailOTP: false });
    }
  });

  test("email canonicalization shares send limits and pending codes", async () => {
    for (const email of [
      "ALICE@example.test",
      "alice@EXAMPLE.test",
      "alice@example.test",
    ]) {
      expect((await send(email)).status).toBe(200);
    }
    expect((await send("ALICE@EXAMPLE.test")).status).toBe(429);
    expect(
      (await verify(required(deliveries.at(-1)).otp, "ALICE@example.test"))
        .status,
    ).toBe(200);
  });

  test("concurrent sends cannot exceed the durable email budget", async () => {
    const replies = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        send("alice@example.test", { ip: `192.0.2.${i + 1}` }),
      ),
    );
    expect(replies.filter((reply) => reply.status === 200)).toHaveLength(3);
    expect(replies.filter((reply) => reply.status === 429)).toHaveLength(5);
    expect(deliveries).toHaveLength(3);
  });
  test("direct verification cannot bypass attempt limits by omitting request headers", async () => {
    await send();
    const otp = required(deliveries[0]).otp;
    const wrong = otp === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const req = request("/sign-in/email-otp", {});
      const api = createOpenMemoryAuth(environment(), req).api;
      await expect(
        api.signInEmailOTP({
          body: { email: "alice@example.test", otp: wrong },
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    }
    expect((await verify(otp)).status).toBe(429);
    expect(await scalar("SELECT count(*) AS n FROM session")).toEqual({ n: 0 });
  });

  test("allowlist removal after code delivery denies sign-in without changing the user", async () => {
    await send();
    expect(
      (
        await verify(required(deliveries[0]).otp, "alice@example.test", {
          env: { OPENMEMORY_AUTH_ALLOWED_EMAILS: "bob@example.test" },
        })
      ).status,
    ).toBe(400);
    expect(
      await scalar("SELECT id FROM user WHERE email='alice@example.test'"),
    ).toEqual({ id: "existing-alice" });
    expect(await scalar("SELECT count(*) AS n FROM session")).toEqual({ n: 0 });
  });
  test("legacy unverified users can complete OTP login with an existing session cookie", async () => {
    await db
      .prepare(
        "INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES('legacy-credential','existing-alice','credential','existing-alice','retained-legacy-hash',unixepoch(),unixepoch())",
      )
      .run();
    await send();
    const initialLogin = await verify(required(deliveries[0]).otp);
    expect(initialLogin.status).toBe(200);
    const cookie = required(
      required(initialLogin.headers.get("set-cookie")).split(";")[0],
    );
    // Model an existing password-era session for an unverified email. The signed
    // cookie and database session remain valid; only the historical user flag differs.
    await db
      .prepare("UPDATE user SET email_verified=0 WHERE id='existing-alice'")
      .run();
    const sendRequest = request("/email-otp/send-verification-otp", {
      email: "alice@example.test",
      type: "sign-in",
    });
    sendRequest.headers.set("cookie", cookie);
    expect(
      (
        await createOpenMemoryAuth(environment(), sendRequest).handler(
          sendRequest,
        )
      ).status,
    ).toBe(200);
    expect(deliveries).toHaveLength(2);
    const verifyRequest = request("/sign-in/email-otp", {
      email: "alice@example.test",
      otp: required(deliveries.at(-1)).otp,
    });
    verifyRequest.headers.set("cookie", cookie);
    const response = await createOpenMemoryAuth(
      environment(),
      verifyRequest,
    ).handler(verifyRequest);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { id: "existing-alice", emailVerified: true },
    });
    expect(
      await scalar("SELECT password FROM account WHERE id='legacy-credential'"),
    ).toEqual({ password: "retained-legacy-hash" });
    expect(
      await scalar(
        "SELECT count(*) AS n FROM user WHERE email='alice@example.test'",
      ),
    ).toEqual({ n: 1 });
  });
});

describe("private Resend adapter with real D1 and passwordless auth", () => {
  function mailEnv(): EmailEnv {
    return {
      RESEND_API_KEY: "synthetic-test-only-provider-key",
      AUTH_EMAIL_FROM: "login@example.test",
      AUTH_EMAIL_MODE: "staging",
      AUTH_EMAIL_ALLOWED_RECIPIENTS: "alice@example.test",
      AUTH_EMAIL_RUN_ID: "integration-run",
      AUTH_EMAIL_RUN_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(),
      SEND_BUDGET_DB: db,
    };
  }
  test.each([
    200, 503,
  ])("real OTP boundary handles provider status %s", async (status) => {
    let capturedCode = "";
    const mail = createAuthEmailWorker({
      fetch: async (_url, init) => {
        const payload = JSON.parse(String(init?.body)) as {
          text: string;
          to: string[];
        };
        expect(payload.to).toEqual(["alice@example.test"]);
        capturedCode = required(payload.text.match(/\b\d{6}\b/)?.[0]);
        return Response.json(
          { id: "00000000-0000-4000-8000-000000000001" },
          { status },
        );
      },
    });
    const env = mailEnv();
    const authOverrides = {
      AUTH_EMAIL: { fetch: (req: Request) => mail.fetch(req, env) },
    };
    expect(
      (await send("alice@example.test", { env: authOverrides })).status,
    ).toBe(200);
    expect(capturedCode).toHaveLength(6);
    const login = await verify(capturedCode, "alice@example.test", {
      env: authOverrides,
    });
    expect(login.status).toBe(status === 200 ? 200 : 400);
    expect(
      await scalar(
        "SELECT attempts FROM send_budget WHERE run_id='integration-run'",
      ),
    ).toEqual({ attempts: 1 });
    if (status !== 200)
      expect(
        await scalar("SELECT count(*) AS n FROM passwordless_otp"),
      ).toEqual({ n: 0 });
  });
  test("D1 reserves at most twelve sends across concurrent adapter instances", async () => {
    let sends = 0;
    const env = mailEnv();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => {
        const adapter = createAuthEmailWorker({
          fetch: async () => {
            sends += 1;
            return Response.json({
              id: "00000000-0000-4000-8000-000000000001",
            });
          },
        });
        return adapter.fetch(
          new Request("https://auth-email.internal/send", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: "alice@example.test",
              otp: "123456",
              type: "sign-in",
              expiresIn: 300,
            }),
          }),
          env,
        );
      }),
    );
    expect(results.filter((response) => response.status === 204)).toHaveLength(
      12,
    );
    expect(results.filter((response) => response.status === 429)).toHaveLength(
      8,
    );
    expect(sends).toBe(12);
    expect(
      await scalar(
        "SELECT attempts FROM send_budget WHERE run_id='integration-run'",
      ),
    ).toEqual({ attempts: 12 });
  });
});
