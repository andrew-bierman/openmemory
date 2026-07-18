import type { Env } from "./env";
import type { RequestLogFields } from "./operational-controls";

export function writeRequestAnalytics(
  env: Env,
  { durationMs, rateLimited, request, response }: RequestLogFields,
) {
  if (!env.OPENMEMORY_ANALYTICS) {
    return;
  }

  const url = new URL(request.url);
  const cf = request as Request & { cf?: { colo?: string } };
  const statusClass = `${Math.floor(response.status / 100)}xx`;
  env.OPENMEMORY_ANALYTICS.writeDataPoint({
    blobs: [
      "openmemory.request",
      request.method,
      url.pathname,
      statusClass,
      String(response.status),
      rateLimited ? "true" : "false",
      cf.cf?.colo ?? "unknown",
    ],
    doubles: [response.status, durationMs, rateLimited ? 1 : 0],
    indexes: [url.pathname],
  });
}

export function writeErrorAnalytics(
  env: Env,
  input: {
    event: string;
    message: string;
    request?: Request;
  },
) {
  if (!env.OPENMEMORY_ANALYTICS) {
    return;
  }

  const path = input.request ? new URL(input.request.url).pathname : "worker";
  env.OPENMEMORY_ANALYTICS.writeDataPoint({
    blobs: [input.event, path, input.message.slice(0, 160)],
    doubles: [1],
    indexes: [input.event],
  });
}

export function writeScheduledHealthAnalytics(
  env: Env,
  input: {
    durationMs: number;
    failedChecks: number;
    notificationSent: boolean;
    status: "healthy" | "unhealthy";
  },
) {
  if (!env.OPENMEMORY_ANALYTICS) {
    return;
  }

  env.OPENMEMORY_ANALYTICS.writeDataPoint({
    blobs: [
      "openmemory.scheduled_health",
      input.status,
      input.notificationSent ? "true" : "false",
    ],
    doubles: [
      input.failedChecks,
      input.durationMs,
      input.notificationSent ? 1 : 0,
    ],
    indexes: ["openmemory.scheduled_health"],
  });
}
