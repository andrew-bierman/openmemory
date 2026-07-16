import type { Env } from "./env";

const DEFAULT_RATE_LIMIT_PER_MINUTE = 600;
const RATE_LIMIT_WINDOW_MS = 60_000;
const buckets = new Map<string, RateLimitBucket>();

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  enabled: boolean;
  headers: Record<string, string>;
  limit: number;
  limited: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export type RequestLogFields = {
  durationMs: number;
  rateLimited: boolean;
  request: Request;
  requestId: string;
  response: Response;
};

export function checkRateLimit(
  request: Request,
  env: Env,
  now = Date.now(),
): RateLimitResult {
  const limit = parsePositiveInteger(
    env.OPENMEMORY_RATE_LIMIT_PER_MINUTE,
    DEFAULT_RATE_LIMIT_PER_MINUTE,
  );
  const disabled =
    request.method === "OPTIONS" ||
    env.OPENMEMORY_RATE_LIMIT_ENABLED === "false" ||
    limit <= 0;

  if (disabled) {
    return rateLimitResult({
      enabled: false,
      limited: false,
      limit,
      remaining: limit,
      retryAfterSeconds: 0,
    });
  }

  cleanupExpiredBuckets(now);
  const key = rateLimitKey(request);
  const bucket = buckets.get(key);
  const current =
    bucket && bucket.resetAt > now
      ? bucket
      : { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  current.count += 1;
  buckets.set(key, current);

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((current.resetAt - now) / 1_000),
  );
  const remaining = Math.max(0, limit - current.count);

  return rateLimitResult({
    enabled: true,
    limited: current.count > limit,
    limit,
    remaining,
    retryAfterSeconds,
  });
}

export function jsonResponse(
  body: unknown,
  init: Omit<ResponseInit, "headers"> & {
    headers?: Record<string, string>;
  } = {},
): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    headers.set(key, value);
  }
  headers.set("content-type", "application/json");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function logRequest({
  durationMs,
  rateLimited,
  request,
  requestId,
  response,
}: RequestLogFields) {
  const url = new URL(request.url);
  const cf = request as Request & { cf?: { colo?: string } };
  console.info(
    JSON.stringify({
      event: "openmemory.request",
      requestId,
      method: request.method,
      path: url.pathname,
      status: response.status,
      durationMs,
      rateLimited,
      colo: cf.cf?.colo,
    }),
  );
}

function rateLimitResult({
  enabled,
  limited,
  limit,
  remaining,
  retryAfterSeconds,
}: Omit<RateLimitResult, "headers">): RateLimitResult {
  return {
    enabled,
    headers: enabled
      ? {
          "retry-after": String(limited ? retryAfterSeconds : 0),
          "x-ratelimit-limit": String(limit),
          "x-ratelimit-remaining": String(remaining),
          "x-ratelimit-reset": String(retryAfterSeconds),
        }
      : {},
    limit,
    limited,
    remaining,
    retryAfterSeconds,
  };
}

function rateLimitKey(request: Request) {
  const headers = request.headers;
  const forwardedFor =
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for") ??
    headers.get("x-real-ip");
  const authorization = headers.get("authorization");
  const cookie = headers.get("cookie");
  const credential = authorization ?? cookie;

  return [
    "global",
    forwardedFor?.split(",")[0]?.trim() || "no-ip",
    credential ? `credential:${stableHash(credential)}` : "no-credential",
  ].join(":");
}

function stableHash(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0).toString(36);
}

function cleanupExpiredBuckets(now: number) {
  if (buckets.size < 5_000) {
    return;
  }

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
