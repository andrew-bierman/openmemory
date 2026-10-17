// Local integration entrypoint only. Production Wrangler configurations never
// reference this module. Fixtures explicitly provision users before real OTP login.

import { env as runtimeEnv } from "cloudflare:workers";
import { handleOpenMemoryAuthRequest } from "../../src/better-auth";
import worker from "../../src/index";

export {
  MemoryExtractionWorkflow,
  MemoryGraph,
  SourceIngestionWorkflow,
} from "../../src/index";

// Never allow synthetic local fixtures to invoke remote AI/Vectorize bindings.
runtimeEnv.AI = undefined;
runtimeEnv.MEMORY_VECTORS = undefined;
const invited = new Set();
const mailbox = new Map();
const delivery = {
  async fetch(request) {
    const message = await request.json();
    mailbox.set(message.email, message.otp);
    return new Response(null, { status: 204 });
  },
};
export default {
  ...worker,
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!["127.0.0.1", "localhost", "openmemory.test"].includes(url.hostname))
      return new Response(null, { status: 404 });
    if (url.pathname === "/api/__test/otp")
      return Response.json({ otp: mailbox.get(url.searchParams.get("email")) });
    if (url.pathname === "/api/__test/remove-invite") {
      const { email } = await request.json();
      invited.delete(email.trim().toLowerCase());
      runtimeEnv.OPENMEMORY_AUTH_ALLOWED_EMAILS = [...invited].join(",");
      return Response.json({ success: true });
    }
    const fixtureEnv = {
      ...env,
      AUTH_EMAIL: delivery,
      AI: undefined,
      MEMORY_VECTORS: undefined,
      BETTER_AUTH_SECRET:
        env.BETTER_AUTH_SECRET ??
        "local-fixture-secret-with-at-least-32-characters",
      OPENMEMORY_AUTH_ALLOWED_EMAILS: [...invited].join(","),
    };
    runtimeEnv.BETTER_AUTH_SECRET = fixtureEnv.BETTER_AUTH_SECRET;
    if (url.pathname !== "/api/__test/session") {
      return worker.fetch(request, fixtureEnv, ctx);
    }
    const { email, name } = await request.json();
    const normalized = email.trim().toLowerCase();
    invited.add(normalized);
    fixtureEnv.OPENMEMORY_AUTH_ALLOWED_EMAILS = [...invited].join(",");
    runtimeEnv.OPENMEMORY_AUTH_ALLOWED_EMAILS =
      fixtureEnv.OPENMEMORY_AUTH_ALLOWED_EMAILS;
    await env.AUTH_DB.prepare(
      "INSERT OR IGNORE INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,0,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        name,
        normalized,
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000),
      )
      .run();
    let otp = "";
    const authEnv = {
      ...fixtureEnv,
      AUTH_EMAIL: {
        async fetch(input, init) {
          const message = await new Request(input, init).json();
          otp = message.otp;
          return new Response(null, { status: 204 });
        },
      },
    };
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    headers.set("cf-connecting-ip", "192.0.2.1");
    const send = await handleOpenMemoryAuthRequest(
      authEnv,
      new Request(
        new URL("/api/auth/email-otp/send-verification-otp", request.url),
        {
          method: "POST",
          headers,
          body: JSON.stringify({ email: normalized, type: "sign-in" }),
        },
      ),
    );
    if (!send.ok || !otp)
      return new Response("OTP fixture delivery failed", { status: 500 });
    return handleOpenMemoryAuthRequest(
      authEnv,
      new Request(new URL("/api/auth/sign-in/email-otp", request.url), {
        method: "POST",
        headers,
        body: JSON.stringify({ email: normalized, otp }),
      }),
    );
  },
};
