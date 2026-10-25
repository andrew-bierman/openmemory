import type { Env } from "./env";
import application from "./index";
import { jsonResponse } from "./operational-controls";

export {
  MemoryExtractionWorkflow,
  MemoryGraph,
  SourceIngestionWorkflow,
} from "./index";

type MaintenanceEnv = Env & {
  OPENMEMORY_TRAFFIC_MODE?: string;
  ASSETS: Fetcher;
};

const applicationPath =
  /^\/(?:api|v1|mcp|consent|\.well-known)(?:\/|$)|^\/(?:health|login)$/;

export default {
  fetch(request: Request, env: MaintenanceEnv, ctx: ExecutionContext) {
    if (env.OPENMEMORY_TRAFFIC_MODE !== "open") {
      return jsonResponse(
        { error: "maintenance" },
        {
          status: 503,
          headers: {
            "cache-control": "no-store",
            "retry-after": "300",
          },
        },
      );
    }
    return applicationPath.test(new URL(request.url).pathname)
      ? application.fetch(request, env, ctx)
      : env.ASSETS.fetch(request);
  },
  queue(batch: MessageBatch<unknown>, env: MaintenanceEnv) {
    if (env.OPENMEMORY_TRAFFIC_MODE === "open")
      return application.queue(batch, env);
    // Emergency backstop only: retries and retention are finite. Pause delivery first.
    batch.retryAll({ delaySeconds: 300 });
  },
  scheduled(
    controller: ScheduledController,
    env: MaintenanceEnv,
    ctx: ExecutionContext,
  ) {
    if (env.OPENMEMORY_TRAFFIC_MODE === "open")
      return application.scheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<MaintenanceEnv>;
