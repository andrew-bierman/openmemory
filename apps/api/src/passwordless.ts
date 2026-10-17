import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { parseUserOutput } from "better-auth/db";
import { emailOTP } from "better-auth/plugins";
import { z } from "zod";
import type { Env } from "./env";

export function isAllowedAuthEmail(env: Env, email: string) {
  const allowed = (env.OPENMEMORY_AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

export async function isAllowedAuthUser(env: Env, userId: string) {
  if (!env.AUTH_DB) return false;
  const user = await env.AUTH_DB.prepare(
    'SELECT email, email_verified FROM "user" WHERE id = ?',
  )
    .bind(userId)
    .first<{ email: string; email_verified: number }>();
  return !!user?.email_verified && isAllowedAuthEmail(env, user.email);
}

export function passwordlessReady(env: Env) {
  return !!(
    env.AUTH_DB &&
    env.AUTH_EMAIL &&
    env.BETTER_AUTH_SECRET &&
    (env.OPENMEMORY_AUTH_ALLOWED_EMAILS ?? "").trim()
  );
}

const unavailable = () =>
  new APIError("SERVICE_UNAVAILABLE", { message: "Sign-in is unavailable." });
const invalid = () =>
  new APIError("BAD_REQUEST", {
    message: "Unable to sign in. Request a new code and try again.",
  });

async function digest(env: Env, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const hash = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function throttle(
  env: Env,
  headers: Headers | undefined,
  email: string,
  action: "send" | "verify",
) {
  const db = env.AUTH_DB;
  const delivery = env.AUTH_EMAIL;
  if (!passwordlessReady(env) || !db || !delivery) throw unavailable();
  // Only Cloudflare's overwritten connecting-IP header is trusted. Missing IPs
  // share a conservative bucket, including server API calls without headers.
  const ip = headers?.get("cf-connecting-ip") ?? "unknown";
  const window = action === "send" ? 900_000 : 300_000;
  const now = Date.now();
  await db
    .prepare("DELETE FROM passwordless_throttle WHERE expires_at <= ?")
    .bind(now)
    .run();
  await db
    .prepare("DELETE FROM passwordless_otp WHERE expires_at <= ?")
    .bind(now)
    .run();
  for (const [kind, value, maximum] of [
    ["ip", ip, action === "send" ? 10 : 30],
    ["email", email, action === "send" ? 3 : 5],
  ] as const) {
    const key = await digest(env, `throttle:${action}:${kind}:${value}`);
    const row = await db
      .prepare(`INSERT INTO passwordless_throttle (key, count, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires_at <= ? THEN 1 ELSE count + 1 END,
      expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
      RETURNING count`)
      .bind(key, now + window, now, now)
      .first<{ count: number }>();
    if (!row || row.count > maximum)
      throw new APIError("TOO_MANY_REQUESTS", {
        message: "Please wait before trying again.",
      });
  }
  return { db, delivery };
}

export function passwordlessGuard(env: Env) {
  return createAuthMiddleware(async (ctx) => {
    const path = ctx.path ?? "";
    // OTP proves the intended recipient independently of any existing cookie.
    // A legacy unverified or removed session must not prevent signing in again.
    const isOtpSignIn =
      path === "/email-otp/send-verification-otp" ||
      path === "/sign-in/email-otp";
    if (ctx.headers?.has("cookie") && path !== "/sign-out" && !isOtpSignIn) {
      const session = await getSessionFromCtx(ctx, {
        disableCookieCache: true,
      });
      if (session && !(await isAllowedAuthUser(env, session.user.id))) {
        throw new APIError("FORBIDDEN", { message: "Sign-in is unavailable." });
      }
    }
    if (
      /password/.test(path) ||
      path === "/sign-up/email" ||
      path === "/sign-in/email" ||
      path === "/change-email" ||
      (path === "/update-user" && ctx.body?.email)
    ) {
      throw new APIError("FORBIDDEN", {
        message: "This authentication method is disabled.",
      });
    }
  });
}

export function passwordlessPlugin(env: Env) {
  const plugin = emailOTP({
    disableSignUp: true,
    storeOTP: "hashed",
    expiresIn: 300,
    allowedAttempts: 5,
    async sendVerificationOTP() {
      throw unavailable();
    },
  });
  // 1.6.14's native verification uses read then delete, which is not atomic on
  // D1. Expose only these two endpoints, using atomic SQL consumption instead.
  return {
    ...plugin,
    endpoints: {
      sendVerificationOTP: createAuthEndpoint(
        "/email-otp/send-verification-otp",
        {
          method: "POST",
          body: z.object({
            email: z.string().email().max(254),
            type: z.literal("sign-in"),
          }),
        },
        async (ctx) => {
          const email = ctx.body.email.trim().toLowerCase();
          const { db, delivery } = await throttle(
            env,
            ctx.headers,
            email,
            "send",
          );
          const user = await ctx.context.internalAdapter.findUserByEmail(email);
          if (!isAllowedAuthEmail(env, email) || !user)
            return ctx.json({ success: true });
          const bytes = new Uint32Array(1);
          // Rejection sampling avoids modulo bias in six-digit codes.
          do {
            crypto.getRandomValues(bytes);
          } while ((bytes[0] ?? 0) >= 4_294_000_000);
          const otp = String((bytes[0] ?? 0) % 1_000_000).padStart(6, "0");
          const hash = await digest(env, `otp:${email}:${otp}`);
          await db
            .prepare(`INSERT INTO passwordless_otp(email, hash, expires_at, attempts) VALUES (?, ?, ?, 0)
        ON CONFLICT(email) DO UPDATE SET hash=excluded.hash, expires_at=excluded.expires_at, attempts=0`)
            .bind(email, hash, Date.now() + 300_000)
            .run();
          try {
            const response = await delivery.fetch(
              new Request("https://auth-email.internal/send", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  email,
                  otp,
                  type: "sign-in",
                  expiresIn: 300,
                }),
              }),
            );
            if (!response.ok) throw unavailable();
          } catch {
            await db
              .prepare(
                "DELETE FROM passwordless_otp WHERE email = ? AND hash = ?",
              )
              .bind(email, hash)
              .run();
            // Preserve the same public send response for invited and unknown
            // addresses even when delivery fails; the invalidated code cannot log in.
            console.error(
              JSON.stringify({ event: "auth_email_delivery_failed" }),
            );
          }
          return ctx.json({ success: true });
        },
      ),
      signInEmailOTP: createAuthEndpoint(
        "/sign-in/email-otp",
        {
          method: "POST",
          body: z.object({
            email: z.string().email().max(254),
            otp: z.string().regex(/^\d{6}$/),
          }),
        },
        async (ctx) => {
          const email = ctx.body.email.trim().toLowerCase();
          const { db } = await throttle(env, ctx.headers, email, "verify");
          const hash = await digest(env, `otp:${email}:${ctx.body.otp}`);
          const now = Date.now();
          // Batch is transactional on D1. Wrong attempts cannot resurrect a used
          // code; exactly one DELETE can return the successfully consumed row.
          const result = await db.batch([
            db
              .prepare(
                "UPDATE passwordless_otp SET attempts = attempts + 1 WHERE email = ? AND expires_at > ?",
              )
              .bind(email, now),
            db
              .prepare(
                "DELETE FROM passwordless_otp WHERE email = ? AND hash = ? AND expires_at > ? AND attempts <= 5 RETURNING email",
              )
              .bind(email, hash, now),
          ]);
          if (!result[1]?.results.length || !isAllowedAuthEmail(env, email))
            throw invalid();
          const found =
            await ctx.context.internalAdapter.findUserByEmail(email);
          if (!found) throw invalid();
          const user = found.user.emailVerified
            ? found.user
            : await ctx.context.internalAdapter.updateUser(found.user.id, {
                emailVerified: true,
              });
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
          );
          if (!session) throw invalid();
          await setSessionCookie(ctx, { session, user });
          return ctx.json({
            token: session.token,
            user: parseUserOutput(ctx.context.options, user),
          });
        },
      ),
    },
  };
}
