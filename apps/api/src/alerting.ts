import type { Env } from "./env";
import { writeScheduledHealthAnalytics } from "./observability";

type ScheduledHealthCheck = {
  name: string;
  ok: boolean;
  status?: number;
  message?: string;
};

type ScheduledHealthResult = {
  checkedAt: string;
  durationMs: number;
  status: "healthy" | "unhealthy";
  baseUrl: string;
  checks: ScheduledHealthCheck[];
  notification: {
    attempted: boolean;
    destinations: string[];
    sent: boolean;
    error?: string;
  };
};

type MonitorDeps = {
  fetch: typeof fetch;
  now: () => Date;
};

const DEFAULT_BASE_URL = "https://openmemory-api.abbierman101.workers.dev";
const PAGERDUTY_EVENTS_URL = "https://events.pagerduty.com/v2/enqueue";

export async function runScheduledHealthMonitor(
  env: Env,
  deps: Partial<MonitorDeps> = {},
): Promise<ScheduledHealthResult> {
  const startedAt = Date.now();
  const now = deps.now ?? (() => new Date());
  const fetcher = deps.fetch ?? fetch;
  const checkedAt = now().toISOString();
  const baseUrl = resolveMonitorBaseUrl(env);
  const checks = await Promise.all([
    checkHealth(fetcher, baseUrl),
    checkProtectedResourceMetadata(fetcher, baseUrl),
  ]);
  const failedChecks = checks.filter((check) => !check.ok);
  const notification =
    failedChecks.length > 0
      ? await notifyScheduledHealthFailure(env, {
          baseUrl,
          checkedAt,
          checks,
          fetcher,
        })
      : {
          attempted: false,
          destinations: [],
          sent: false,
        };
  const result: ScheduledHealthResult = {
    checkedAt,
    durationMs: Date.now() - startedAt,
    status: failedChecks.length > 0 ? "unhealthy" : "healthy",
    baseUrl,
    checks,
    notification,
  };

  writeScheduledHealthAnalytics(env, {
    durationMs: result.durationMs,
    failedChecks: failedChecks.length,
    notificationSent: notification.sent,
    status: result.status,
  });

  const logEvent =
    result.status === "healthy"
      ? "openmemory.scheduled_health"
      : "openmemory.scheduled_health_failed";
  console[result.status === "healthy" ? "log" : "error"](
    JSON.stringify({
      event: logEvent,
      baseUrl,
      checkedAt,
      failedChecks: failedChecks.length,
      notificationSent: notification.sent,
    }),
  );

  return result;
}

function resolveMonitorBaseUrl(env: Env) {
  const raw =
    env.OPENMEMORY_BASE_URL ?? env.BETTER_AUTH_URL ?? DEFAULT_BASE_URL;
  const url = new URL(raw);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function checkHealth(
  fetcher: typeof fetch,
  baseUrl: string,
): Promise<ScheduledHealthCheck> {
  try {
    const response = await fetcher(`${baseUrl}/health`, {
      headers: { accept: "application/json" },
    });
    const body = await response.json().catch(() => undefined);
    const ok =
      response.ok &&
      isRecord(body) &&
      body.ok === true &&
      body.service === "openmemory-api";
    return {
      name: "health",
      ok,
      status: response.status,
      message: ok ? undefined : "health_response_invalid",
    };
  } catch (error) {
    return {
      name: "health",
      ok: false,
      message: error instanceof Error ? error.message : "health_fetch_failed",
    };
  }
}

async function checkProtectedResourceMetadata(
  fetcher: typeof fetch,
  baseUrl: string,
): Promise<ScheduledHealthCheck> {
  try {
    const response = await fetcher(
      `${baseUrl}/.well-known/oauth-protected-resource/mcp`,
      { headers: { accept: "application/json" } },
    );
    const body = await response.json().catch(() => undefined);
    const ok =
      response.ok &&
      isRecord(body) &&
      typeof body.resource === "string" &&
      body.resource.endsWith("/mcp") &&
      Array.isArray(body.authorization_servers) &&
      body.authorization_servers.length > 0;
    return {
      name: "oauth_protected_resource",
      ok,
      status: response.status,
      message: ok ? undefined : "protected_resource_metadata_invalid",
    };
  } catch (error) {
    return {
      name: "oauth_protected_resource",
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "protected_resource_fetch_failed",
    };
  }
}

async function notifyScheduledHealthFailure(
  env: Env,
  input: {
    baseUrl: string;
    checkedAt: string;
    checks: ScheduledHealthCheck[];
    fetcher: typeof fetch;
  },
) {
  const destinations = [
    env.OPENMEMORY_ALERT_WEBHOOK_URL ? "webhook" : undefined,
    env.OPENMEMORY_ALERT_EMAIL_ENDPOINT ? "email_endpoint" : undefined,
    env.OPENMEMORY_ALERT_PAGERDUTY_ROUTING_KEY ? "pagerduty" : undefined,
  ].filter(Boolean) as string[];
  if (destinations.length === 0) {
    return {
      attempted: false,
      destinations,
      sent: false,
    };
  }

  const payload = {
    service: "openmemory-api",
    severity: "critical",
    event: "openmemory.scheduled_health_failed",
    baseUrl: input.baseUrl,
    checkedAt: input.checkedAt,
    failedChecks: input.checks.filter((check) => !check.ok),
    checks: input.checks,
  };

  const results = await Promise.allSettled([
    env.OPENMEMORY_ALERT_WEBHOOK_URL
      ? postJson(input.fetcher, env.OPENMEMORY_ALERT_WEBHOOK_URL, payload, {
          authorization: env.OPENMEMORY_ALERT_WEBHOOK_TOKEN
            ? `Bearer ${env.OPENMEMORY_ALERT_WEBHOOK_TOKEN}`
            : undefined,
        })
      : Promise.resolve(undefined),
    env.OPENMEMORY_ALERT_EMAIL_ENDPOINT
      ? postJson(input.fetcher, env.OPENMEMORY_ALERT_EMAIL_ENDPOINT, {
          ...payload,
          subject: "[OpenMemory] scheduled health check failed",
        })
      : Promise.resolve(undefined),
    env.OPENMEMORY_ALERT_PAGERDUTY_ROUTING_KEY
      ? postJson(input.fetcher, PAGERDUTY_EVENTS_URL, {
          routing_key: env.OPENMEMORY_ALERT_PAGERDUTY_ROUTING_KEY,
          event_action: "trigger",
          dedup_key: `openmemory.scheduled_health_failed:${input.baseUrl}`,
          payload: {
            summary: `OpenMemory scheduled health failed for ${input.baseUrl}`,
            source: input.baseUrl,
            severity: "critical",
            component: "openmemory-api",
            group: "production",
            class: "scheduled-health",
            timestamp: input.checkedAt,
            custom_details: payload,
          },
        })
      : Promise.resolve(undefined),
  ]);

  const failed = results.find((result) => result.status === "rejected");
  return {
    attempted: true,
    destinations,
    sent: !failed,
    error:
      failed?.status === "rejected"
        ? failed.reason instanceof Error
          ? failed.reason.message
          : "notification_failed"
        : undefined,
  };
}

async function postJson(
  fetcher: typeof fetch,
  url: string,
  body: unknown,
  headers: { authorization?: string } = {},
) {
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers.authorization
        ? { authorization: headers.authorization }
        : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`alert_destination_failed:${response.status}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
