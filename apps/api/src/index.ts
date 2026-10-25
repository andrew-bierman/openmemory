import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  env as workerEnv,
} from "cloudflare:workers";
import {
  ContextSchema,
  CreateMemorySchema,
  createSourceId,
  ForgetMemorySchema,
  GraphEdgeSchema,
  GraphExportPayloadSchema,
  IngestConversationSchema,
  IngestSourceSchema,
  normalizeTenantId,
  UpdateMemorySchema,
} from "@openmemory/core";
import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import {
  deleteAccountControlPlane,
  getAccount,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  renameWorkspace,
  updateAccountProfile,
} from "./account";
import { runScheduledHealthMonitor } from "./alerting";
import {
  getGraph,
  type HeaderSource,
  isLocalDevelopmentRequest,
  resolveAuth,
  resolveSessionTenant,
  resolveTenant,
} from "./auth";
import { parseWorkGeneration, workflowInstanceId } from "./background-work";
import {
  handleOpenMemoryAuthRequest,
  isAuthRoute,
  resolveOpenMemorySession,
} from "./better-auth";
import type { Env } from "./env";
import { deleteTenantExports, tenantExportPrefix } from "./export-storage";
import {
  enqueueMemoryExtraction,
  MEMORY_EXTRACTION_QUEUE_NAME,
  type MemoryExtractionMessage,
  parseMemoryExtractionMessage,
  processMemoryExtractionMessage,
} from "./extraction-worker";
import { createOpenMemoryMcpHandler } from "./mcp";
import { MemoryGraph } from "./memory-graph";
import { enrichMemoryInput } from "./memory-signals";
import {
  createOAuthClient,
  disableOAuthClient,
  listOAuthClients,
  listOAuthConnections,
  revokeOAuthConnection,
} from "./oauth-connections";
import { writeErrorAnalytics, writeRequestAnalytics } from "./observability";
import {
  checkGlobalRateLimit,
  jsonResponse,
  logRequest,
  type RateLimitResult,
} from "./operational-controls";
import { getReadinessSnapshot } from "./readiness";
import { buildRecallContext, searchMemories } from "./recall";
import {
  deleteTenantVectors,
  getSemanticIndexDiagnostic,
  indexMemory,
} from "./semantic-index";
import {
  getGraphForTenant,
  type IngestionQueueMessage,
  indexMemoryWithGeneration,
  ingestConversationTranscript,
  ingestSourceDocument,
  processSourceIngestionMessage,
  SOURCE_INGESTION_QUEUE_NAME,
} from "./source-ingestion";
import {
  assertWorkspaceRequestOrigin,
  WorkspaceAccessError,
} from "./workspace-access";
import { handleWorkspaceRequest, isWorkspaceRoute } from "./workspace-routes";

export { MemoryGraph };

export class SourceIngestionWorkflow extends WorkflowEntrypoint<
  Env,
  IngestionQueueMessage
> {
  async run(
    event: Readonly<WorkflowEvent<IngestionQueueMessage>>,
    step: WorkflowStep,
  ) {
    return step.do(
      "ingest source document",
      { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } },
      async () => {
        const result = await processSourceIngestionMessage(
          this.env,
          event.payload,
        );
        return {
          sourceId: result.sourceId,
          chunkCount: result.chunkCount,
          memoryIds: result.memories.map((memory) => memory.id),
          edgeCount: result.edges.length,
        };
      },
    );
  }
}

export class MemoryExtractionWorkflow extends WorkflowEntrypoint<
  Env,
  MemoryExtractionMessage
> {
  async run(
    event: Readonly<WorkflowEvent<MemoryExtractionMessage>>,
    step: WorkflowStep,
  ) {
    return step.do(
      "extract memory entities and relationships",
      { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } },
      async () => processMemoryExtractionMessage(this.env, event.payload),
    );
  }
}

const env = workerEnv as unknown as Env;

const memoryBody = t.Object({
  content: t.String({ minLength: 1, maxLength: 200_000 }),
  source: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  conversationId: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  tags: t.Optional(
    t.Array(t.String({ minLength: 1, maxLength: 80 }), { maxItems: 50 }),
  ),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
  type: t.Optional(
    t.Union([
      t.Literal("fact"),
      t.Literal("preference"),
      t.Literal("decision"),
      t.Literal("episode"),
      t.Literal("insight"),
      t.Literal("profile"),
    ]),
  ),
  confidence: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  importance: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  validFrom: t.Optional(t.String()),
  validUntil: t.Optional(t.String()),
  entityIds: t.Optional(
    t.Array(t.String({ minLength: 1, maxLength: 160 }), { maxItems: 50 }),
  ),
});

const searchBody = t.Object({
  q: t.String({ minLength: 1, maxLength: 4_000 }),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 50 })),
  tags: t.Optional(
    t.Array(t.String({ minLength: 1, maxLength: 80 }), { maxItems: 50 }),
  ),
  includeHistorical: t.Optional(t.Boolean()),
  includeForgotten: t.Optional(t.Boolean()),
});

const updateBody = t.Object({
  content: t.String({ minLength: 1, maxLength: 200_000 }),
  relationship: t.Optional(
    t.Union([t.Literal("updates"), t.Literal("extends"), t.Literal("derives")]),
  ),
  source: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  tags: t.Optional(
    t.Array(t.String({ minLength: 1, maxLength: 80 }), { maxItems: 50 }),
  ),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
  confidence: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  importance: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  validFrom: t.Optional(t.String()),
  validUntil: t.Optional(t.String()),
});

const forgetBody = t.Object({
  reason: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
});

const tenantPurgeBody = t.Object({
  confirmTenantId: t.String({ minLength: 1, maxLength: 200 }),
});

const accountDeletionBody = t.Object({
  confirmEmail: t.String({ minLength: 3, maxLength: 320 }),
  confirmTenantId: t.String({ minLength: 1, maxLength: 200 }),
});

const graphImportBody = t.Object({
  confirmTenantId: t.String({ minLength: 1, maxLength: 200 }),
  mode: t.Union([t.Literal("replace"), t.Literal("merge")]),
  conflictPolicy: t.Optional(
    t.Union([
      t.Literal("skip"),
      t.Literal("overwrite"),
      t.Literal("semantic_merge"),
    ]),
  ),
  export: t.Unknown(),
});

const edgeBody = t.Object({
  sourceId: t.String({ minLength: 1 }),
  targetId: t.String({ minLength: 1 }),
  relationship: t.String({ minLength: 1, maxLength: 80 }),
  weight: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
});

const contextBody = t.Object({
  q: t.String({ minLength: 1, maxLength: 4_000 }),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
  includeProfile: t.Optional(t.Boolean()),
  includeHistorical: t.Optional(t.Boolean()),
});

const sourceBody = t.Object({
  content: t.String({ minLength: 1, maxLength: 500_000 }),
  source: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  conversationId: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  tags: t.Optional(
    t.Array(t.String({ minLength: 1, maxLength: 80 }), { maxItems: 50 }),
  ),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
  chunkSize: t.Optional(t.Number({ minimum: 400, maximum: 4_000 })),
  overlap: t.Optional(t.Number({ minimum: 0, maximum: 800 })),
});

const conversationMessageBody = t.Object({
  role: t.Union([
    t.Literal("system"),
    t.Literal("developer"),
    t.Literal("user"),
    t.Literal("assistant"),
    t.Literal("tool"),
  ]),
  content: t.String({ minLength: 1, maxLength: 200_000 }),
  name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  timestamp: t.Optional(t.String()),
});

const conversationBody = t.Object({
  conversationId: t.String({ minLength: 1, maxLength: 200 }),
  source: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  tags: t.Optional(
    t.Array(t.String({ minLength: 1, maxLength: 80 }), { maxItems: 50 }),
  ),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
  messages: t.Array(conversationMessageBody, {
    minItems: 1,
    maxItems: 1_000,
  }),
  chunkSize: t.Optional(t.Number({ minimum: 400, maximum: 4_000 })),
  overlap: t.Optional(t.Number({ minimum: 0, maximum: 800 })),
});

const workspaceBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
});

const accountProfileBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
});

const workspaceMemberBody = t.Object({
  email: t.String({ minLength: 3, maxLength: 320 }),
  role: t.Optional(t.Union([t.Literal("admin"), t.Literal("member")])),
});

async function withTenant(request: Request, headers: HeaderSource) {
  const auth = resolveAuth(env, headers);
  if (!auth.ok) {
    return {
      tenant: auth,
      graph: undefined,
      sessionTenant: undefined,
    };
  }

  const sessionTenant = await resolveSessionTenant(env, request);
  if (sessionTenant) {
    return {
      tenant: sessionTenant,
      graph: getGraph(env, sessionTenant.tenantId),
      sessionTenant,
    };
  }

  const tenant = resolveTenant(headers, {
    allowHeaderTenant: isLocalDevelopmentRequest(request),
  });
  if ("error" in tenant) {
    return {
      tenant,
      graph: undefined,
      sessionTenant: undefined,
    };
  }

  return {
    tenant,
    graph: getGraph(env, tenant.tenantId),
    sessionTenant: undefined,
  };
}

function errorStatus(error: string) {
  return error === "missing_tenant" ||
    error === "unauthorized" ||
    error === "header_tenant_disabled"
    ? 401
    : 400;
}

function tenantError(
  tenant: Awaited<ReturnType<typeof withTenant>>["tenant"],
): string {
  return "error" in tenant && tenant.error ? tenant.error : "unauthorized";
}

export const app = new Elysia({ adapter: CloudflareAdapter })
  .get(
    "/login",
    () =>
      new Response(LOGIN_HTML, {
        headers: { "content-type": "text/html" },
      }),
  )
  .get(
    "/consent",
    () =>
      new Response(CONSENT_HTML, {
        headers: { "content-type": "text/html" },
      }),
  )
  .get("/health", () => ({
    ok: true,
    service: "openmemory-api",
    features: ["graph-memory", "profile", "context", "mcp-json-rpc"],
  }))
  .get("/v1/account", async ({ request, status }) => {
    const result = await getAccount(env, request);
    return status(result.status, result.body);
  })
  .delete(
    "/v1/account",
    async ({ body, request, status }) => {
      const session = await resolveOpenMemorySession(env, request);
      if (!session) {
        return status(401, { error: "unauthorized" as const });
      }
      if (!env.AUTH_DB) {
        return status(503, { error: "auth_db_unavailable" as const });
      }

      const tenantId = normalizeTenantId(session.user.id);
      if (
        !tenantId ||
        normalizeTenantId(body.confirmTenantId) !== tenantId ||
        body.confirmEmail.trim().toLowerCase() !==
          session.user.email.trim().toLowerCase()
      ) {
        return status(409, {
          error: "account_confirmation_mismatch" as const,
          message:
            "confirmEmail and confirmTenantId must match the authenticated account before deletion.",
        });
      }

      const graph = getGraph(env, tenantId);
      const purged = await graph.purgeTenantData(true);
      const vectorIndex = await deleteTenantVectors(
        env,
        tenantId,
        purged.deletedMemoryIds,
        purged.purgedGeneration,
      );
      const exports = await deleteTenantExports(env, tenantId);
      const deleted = await deleteAccountControlPlane(env, request, {
        confirmEmail: body.confirmEmail,
        confirmTenantId: body.confirmTenantId,
        tenantId,
      });

      return status(deleted.status, {
        ...deleted.body,
        graph: {
          memoriesDeleted: purged.memoriesDeleted,
          edgesDeleted: purged.edgesDeleted,
          tagsDeleted: purged.tagsDeleted,
          entitiesDeleted: purged.entitiesDeleted,
          ingestionJobsDeleted: purged.ingestionJobsDeleted,
          vectorIndex,
          exports,
          purgedAt: purged.purgedAt,
        },
      });
    },
    { body: accountDeletionBody },
  )
  .patch(
    "/v1/account/profile",
    async ({ body, request, status }) => {
      const result = await updateAccountProfile(env, request, body);
      return status(result.status, result.body);
    },
    { body: accountProfileBody },
  )
  .patch(
    "/v1/account/workspace",
    async ({ body, request, status }) => {
      const result = await renameWorkspace(env, request, body);
      return status(result.status, result.body);
    },
    { body: workspaceBody },
  )
  .post(
    "/v1/account/members",
    async ({ body, request, status }) => {
      const result = await inviteWorkspaceMember(env, request, body);
      return status(result.status, result.body);
    },
    { body: workspaceMemberBody },
  )
  .delete(
    "/v1/account/members/:memberId",
    async ({ params, request, status }) => {
      const result = await removeWorkspaceMember(env, request, params.memberId);
      return status(result.status, result.body);
    },
  )
  .delete(
    "/v1/tenant",
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      if (body.confirmTenantId !== tenantId) {
        return status(409, {
          error: "tenant_confirmation_mismatch" as const,
          message:
            "confirmTenantId must match the resolved tenant before data is purged.",
        });
      }

      const purged = await graph.purgeTenantData();
      const vectorIndex = await deleteTenantVectors(
        env,
        tenantId,
        purged.deletedMemoryIds,
        purged.purgedGeneration,
      );
      const exports = await deleteTenantExports(env, tenantId);

      return {
        tenantId,
        memoriesDeleted: purged.memoriesDeleted,
        edgesDeleted: purged.edgesDeleted,
        tagsDeleted: purged.tagsDeleted,
        entitiesDeleted: purged.entitiesDeleted,
        ingestionJobsDeleted: purged.ingestionJobsDeleted,
        vectorIndex,
        exports,
        purgedAt: purged.purgedAt,
      };
    },
    { body: tenantPurgeBody },
  )
  .post(
    "/v1/memories",
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const generation = await graph.getIngestionGeneration();
      const memory = await graph.createMemory(
        CreateMemorySchema.parse(
          enrichMemoryInput({
            source: "api",
            tags: [],
            metadata: {},
            ...body,
          }),
        ),
        generation,
      );
      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      await indexMemoryWithGeneration(env, tenantId, graph, memory, generation);
      await graph.linkRelatedMemories(memory.id, generation);
      await enqueueMemoryExtraction(env, {
        memoryId: memory.id,
        generation,
        reason: "create",
        tenantId,
      });
      return status(201, memory);
    },
    { body: memoryBody },
  )
  .post(
    "/v1/ingest",
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const generation = await graph.getIngestionGeneration();
      const memory = await graph.createMemory(
        CreateMemorySchema.parse(
          enrichMemoryInput({
            source: "ingest",
            tags: [],
            metadata: {},
            ...body,
          }),
        ),
        generation,
      );
      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      await indexMemoryWithGeneration(env, tenantId, graph, memory, generation);
      const edges = await graph.linkRelatedMemories(memory.id, generation);
      await enqueueMemoryExtraction(env, {
        memoryId: memory.id,
        generation,
        reason: "create",
        tenantId,
      });
      return status(201, { memory, edges });
    },
    { body: memoryBody },
  )
  .post(
    "/v1/sources",
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const input = IngestSourceSchema.parse({
        source: "document",
        tags: [],
        metadata: {},
        ...body,
      });
      const sourceId = createSourceId();
      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      return status(
        201,
        await ingestSourceDocument({
          env,
          graph,
          input,
          sourceId,
          tenantId,
          extractionReason: "source",
        }),
      );
    },
    { body: sourceBody },
  )
  .post(
    "/v1/sources/async",
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }
      if (!env.SOURCE_INGESTION_QUEUE) {
        return status(503, {
          error: "source_ingestion_queue_unavailable" as const,
        });
      }

      const input = IngestSourceSchema.parse({
        source: "document",
        tags: [],
        metadata: {},
        ...body,
      });
      const sourceId = createSourceId();
      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      const job = await graph.createIngestionJob({
        sourceId,
        input,
        metadata: {
          strategy: "queue-workflow-source-ingestion-v1",
          queue: env.SOURCE_INGESTION_QUEUE_NAME ?? SOURCE_INGESTION_QUEUE_NAME,
        },
      });
      await env.SOURCE_INGESTION_QUEUE.send(
        {
          version: 1,
          sourceId,
          tenantId,
          input,
          requestedAt: job.createdAt,
          generation: job.generation,
        },
        { contentType: "json" },
      );

      return status(202, job);
    },
    { body: sourceBody },
  )
  .post(
    "/v1/conversations",
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const input = IngestConversationSchema.parse({
        source: "conversation",
        tags: [],
        metadata: {},
        ...body,
      });
      const sourceId = createSourceId();
      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      return status(
        201,
        await ingestConversationTranscript({
          env,
          graph,
          input,
          sourceId,
          tenantId,
          extractionReason: "source",
        }),
      );
    },
    { body: conversationBody },
  )
  .post(
    "/v1/conversations/async",
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }
      if (!env.SOURCE_INGESTION_QUEUE) {
        return status(503, {
          error: "source_ingestion_queue_unavailable" as const,
        });
      }

      const input = IngestConversationSchema.parse({
        source: "conversation",
        tags: [],
        metadata: {},
        ...body,
      });
      const sourceId = createSourceId();
      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      const job = await graph.createIngestionJob({
        sourceId,
        input,
        metadata: {
          kind: "conversation",
          conversationId: input.conversationId,
          strategy: "queue-workflow-conversation-ingestion-v1",
          queue: env.SOURCE_INGESTION_QUEUE_NAME ?? SOURCE_INGESTION_QUEUE_NAME,
        },
      });
      await env.SOURCE_INGESTION_QUEUE.send(
        {
          kind: "conversation",
          version: 1,
          sourceId,
          tenantId,
          input,
          requestedAt: job.createdAt,
          generation: job.generation,
        },
        { contentType: "json" },
      );

      return status(202, job);
    },
    { body: conversationBody },
  )
  .get(
    "/v1/sources/:sourceId",
    async ({ headers, params, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const job = await graph.getIngestionJob(params.sourceId);
      if (!job) {
        return status(404, { error: "not_found" as const });
      }
      return job;
    },
  )
  .get("/v1/memories", async ({ headers, query, request, status }) => {
    const { tenant, graph } = await withTenant(request, headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    const rawLimit = typeof query.limit === "string" ? Number(query.limit) : 25;
    const includeHistorical = query.includeHistorical === "true";
    return graph.listMemories(
      Number.isFinite(rawLimit) ? rawLimit : 25,
      includeHistorical,
    );
  })
  .get("/v1/memories/:id", async ({ headers, params, request, status }) => {
    const { tenant, graph } = await withTenant(request, headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    const memory = await graph.getMemory(params.id);
    if (!memory) {
      return status(404, { error: "not_found" as const });
    }

    return memory;
  })
  .patch(
    "/v1/memories/:id",
    async ({ body, headers, params, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const generation = await graph.getIngestionGeneration();
      const memory = await graph.updateMemory(
        params.id,
        UpdateMemorySchema.parse(enrichMemoryInput({ metadata: {}, ...body })),
        generation,
      );
      if (!memory) {
        return status(404, { error: "not_found" as const });
      }
      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      await indexMemoryWithGeneration(env, tenantId, graph, memory, generation);
      await graph.linkRelatedMemories(memory.id, generation);
      await enqueueMemoryExtraction(env, {
        memoryId: memory.id,
        generation,
        reason: "update",
        tenantId,
      });
      return memory;
    },
    { body: updateBody },
  )
  .delete(
    "/v1/memories/:id",
    async ({ body, headers, params, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const memory = await graph.forgetMemory(
        params.id,
        ForgetMemorySchema.parse(body ?? {}),
      );
      if (!memory) {
        return status(404, { error: "not_found" as const });
      }
      return memory;
    },
    { body: t.Optional(forgetBody) },
  )
  .post(
    "/v1/search",
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      return searchMemories(
        env,
        "tenantId" in tenant ? tenant.tenantId : "",
        graph,
        body,
      );
    },
    { body: searchBody },
  )
  .post(
    "/v1/context",
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      return buildRecallContext(
        env,
        "tenantId" in tenant ? tenant.tenantId : "",
        graph,
        ContextSchema.parse(body),
      );
    },
    { body: contextBody },
  )
  .get("/v1/profile", async ({ headers, request, status }) => {
    const { tenant, graph } = await withTenant(request, headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    return graph.getProfile();
  })
  .get("/v1/readiness", async ({ headers, request, status }) => {
    const { tenant, graph, sessionTenant } = await withTenant(request, headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
    return getReadinessSnapshot({
      env,
      graph,
      request,
      sessionTenant,
      tenantId,
    });
  })
  .get("/v1/oauth/connections", async ({ request, status }) => {
    const result = await listOAuthConnections(env, request);
    return status(result.status, result.body);
  })
  .get("/v1/oauth/clients", async ({ request, status }) => {
    const result = await listOAuthClients(env, request);
    return status(result.status, result.body);
  })
  .post(
    "/v1/oauth/clients",
    async ({ request, status }) => {
      const result = await createOAuthClient(env, request);
      return status(result.status, result.body);
    },
    { parse: "none" },
  )
  .delete(
    "/v1/oauth/clients/:clientId",
    async ({ params, request, status }) => {
      const result = await disableOAuthClient(env, request, params.clientId);
      return status(result.status, result.body);
    },
  )
  .delete(
    "/v1/oauth/connections/:clientId",
    async ({ params, request, status }) => {
      const result = await revokeOAuthConnection(env, request, params.clientId);
      return status(result.status, result.body);
    },
  )
  .post("/v1/exports", async ({ headers, request, status }) => {
    const { tenant, graph } = await withTenant(request, headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    const tenantId = "tenantId" in tenant ? tenant.tenantId : "unknown";
    const graphExport = await graph.exportGraph();
    const body = JSON.stringify(graphExport);
    const key = `${tenantExportPrefix(tenantId)}${graphExport.exportedAt.replace(/[:.]/g, "-")}.json`;

    if (env.MEMORY_EXPORTS) {
      await env.MEMORY_EXPORTS.put(key, body, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
          tenantId,
          exportedAt: graphExport.exportedAt,
          version: String(graphExport.version),
        },
      });
    }

    return status(201, {
      key,
      bytes: new TextEncoder().encode(body).byteLength,
      memoryCount: graphExport.memories.length,
      edgeCount: graphExport.edges.length,
      writtenToR2: Boolean(env.MEMORY_EXPORTS),
    });
  })
  .post(
    "/v1/imports/preview",
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      if (normalizeTenantId(body.confirmTenantId) !== tenantId) {
        return status(409, {
          error: "tenant_confirmation_mismatch" as const,
          message:
            "confirmTenantId must match the resolved tenant before data is restored.",
        });
      }

      const graphExport = GraphExportPayloadSchema.safeParse(body.export);
      if (!graphExport.success) {
        return status(400, {
          error: "invalid_graph_export" as const,
          message: "The import payload must be an OpenMemory graph export.",
        });
      }

      try {
        const preview = await graph.previewGraphImport(
          graphExport.data,
          body.mode,
          body.conflictPolicy ?? "skip",
        );

        return {
          tenantId,
          ...preview,
        };
      } catch (error) {
        return status(400, {
          error: "graph_import_failed" as const,
          message: error instanceof Error ? error.message : "unknown_error",
        });
      }
    },
    { body: graphImportBody },
  )
  .post(
    "/v1/imports",
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const tenantId = "tenantId" in tenant ? tenant.tenantId : "";
      if (normalizeTenantId(body.confirmTenantId) !== tenantId) {
        return status(409, {
          error: "tenant_confirmation_mismatch" as const,
          message:
            "confirmTenantId must match the resolved tenant before data is restored.",
        });
      }

      const graphExport = GraphExportPayloadSchema.safeParse(body.export);
      if (!graphExport.success) {
        return status(400, {
          error: "invalid_graph_export" as const,
          message: "The import payload must be an OpenMemory graph export.",
        });
      }

      try {
        if (body.mode === "merge") {
          const merged = await graph.mergeGraph(
            graphExport.data,
            body.conflictPolicy ?? "skip",
          );
          const indexedMemoryIds = new Set([
            ...merged.importedMemoryIds,
            ...merged.overwrittenMemoryIds,
            ...merged.mergedMemoryIds,
          ]);
          const activeMemories =
            merged.mergedMemoryIds.length > 0
              ? (
                  await Promise.all(
                    [...indexedMemoryIds].map((id) => graph.getMemory(id)),
                  )
                ).filter(
                  (memory) =>
                    memory && memory.status === "active" && memory.isLatest,
                )
              : graphExport.data.memories.filter(
                  (memory) =>
                    indexedMemoryIds.has(memory.id) &&
                    memory.status === "active" &&
                    memory.isLatest,
                );
          for (const memory of activeMemories) {
            await indexMemory(env, tenantId, memory);
          }

          return status(201, {
            tenantId,
            mode: body.mode,
            version: merged.version,
            memoriesImported: merged.memoriesImported,
            memoriesSkipped: merged.memoriesSkipped,
            memoriesOverwritten: merged.memoriesOverwritten,
            memoriesMerged: merged.memoriesMerged,
            edgesImported: merged.edgesImported,
            activeMemoriesIndexed: activeMemories.length,
            merged: {
              memoriesSkipped: merged.memoriesSkipped,
              memoriesOverwritten: merged.memoriesOverwritten,
              memoriesMerged: merged.memoriesMerged,
            },
            importedAt: merged.importedAt,
          });
        }

        const restored = await graph.restoreGraph(graphExport.data);
        const vectorIndex = await deleteTenantVectors(
          env,
          tenantId,
          restored.purged.deletedMemoryIds,
          restored.purged.purgedGeneration,
        );
        const activeMemories = graphExport.data.memories.filter(
          (memory) => memory.status === "active" && memory.isLatest,
        );
        for (const memory of activeMemories) {
          await indexMemory(env, tenantId, memory);
        }

        return status(201, {
          tenantId,
          mode: body.mode,
          version: restored.version,
          memoriesImported: restored.memoriesImported,
          edgesImported: restored.edgesImported,
          activeMemoriesIndexed: activeMemories.length,
          replaced: {
            memoriesDeleted: restored.purged.memoriesDeleted,
            edgesDeleted: restored.purged.edgesDeleted,
            tagsDeleted: restored.purged.tagsDeleted,
            entitiesDeleted: restored.purged.entitiesDeleted,
            ingestionJobsDeleted: restored.purged.ingestionJobsDeleted,
            vectorIndex,
            purgedAt: restored.purged.purgedAt,
          },
          importedAt: restored.importedAt,
        });
      } catch (error) {
        return status(400, {
          error: "graph_import_failed" as const,
          message: error instanceof Error ? error.message : "unknown_error",
        });
      }
    },
    { body: graphImportBody },
  )
  .post("/v1/index/repair", async ({ headers, request, status }) => {
    const { tenant, graph } = await withTenant(request, headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    const tenantId = "tenantId" in tenant ? tenant.tenantId : "unknown";
    const repairGeneration = await graph.getIngestionGeneration();
    const before = await graph.getIndexInventory();
    const staleVectors = await deleteTenantVectors(
      env,
      tenantId,
      before.purgeableMemoryIds,
      repairGeneration,
    );
    const memories = await graph.listIndexableMemories();
    const indexResults = [];
    for (const memory of memories) {
      indexResults.push(await indexMemory(env, tenantId, memory));
    }
    const after = await getSemanticIndexDiagnostic(env, tenantId, before);
    const indexErrors = indexResults
      .filter((result) => result.error)
      .map((result) => ({
        vectorId: result.vectorId,
        error: result.error,
      }))
      .slice(0, 5);

    return status(202, {
      attempted: memories.length,
      expectedVectors: before.indexableMemories,
      indexed: indexResults.filter((result) => result.indexed).length,
      failed: indexResults.filter(
        (result) => result.attempted && !result.indexed,
      ).length,
      skipped: indexResults.filter((result) => !result.attempted).length,
      errorSample: indexErrors,
      purgeableMemories: before.purgeableMemories,
      staleVectors,
      tenantId,
      vectorizeConfigured: Boolean(env.AI && env.MEMORY_VECTORS),
      semanticIndex: after,
    });
  })
  .post(
    "/v1/graph/edges",
    async ({ body, headers, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      const parsedEdge = GraphEdgeSchema.safeParse({ metadata: {}, ...body });
      if (!parsedEdge.success) {
        return status(422, {
          error: "invalid_graph_edge" as const,
          issues: parsedEdge.error.issues,
        });
      }

      return status(201, await graph.addEdge(parsedEdge.data));
    },
    { body: edgeBody },
  )
  .get("/v1/graph/stats", async ({ headers, request, status }) => {
    const { tenant, graph } = await withTenant(request, headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    return graph.getStats();
  })
  .get("/v1/graph/relationships", async ({ headers, request, status }) => {
    const { tenant, graph } = await withTenant(request, headers);
    if (!graph) {
      return status(errorStatus(tenantError(tenant)), tenant);
    }

    return graph.getRelationshipCatalog();
  })
  .get(
    "/v1/graph/:id/neighbors",
    async ({ headers, params, request, status }) => {
      const { tenant, graph } = await withTenant(request, headers);
      if (!graph) {
        return status(errorStatus(tenantError(tenant)), tenant);
      }

      return graph.getNeighbors(params.id);
    },
  );

export type App = typeof app;

const apiWorker = app.compile();
const mcpHandler = createOpenMemoryMcpHandler();

export default {
  fetch(request: Request, requestEnv: Env, ctx: ExecutionContext) {
    return handleWorkerFetch(request, requestEnv, ctx);
  },
  scheduled(
    _controller: ScheduledController,
    requestEnv: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(runScheduledHealthMonitor(requestEnv));
  },
  queue(batch: MessageBatch<unknown>, requestEnv: Env) {
    const extractionQueue =
      requestEnv.MEMORY_EXTRACTION_QUEUE_NAME ?? MEMORY_EXTRACTION_QUEUE_NAME;
    const sourceQueue =
      requestEnv.SOURCE_INGESTION_QUEUE_NAME ?? SOURCE_INGESTION_QUEUE_NAME;
    if (!extractionQueue || !sourceQueue || extractionQueue === sourceQueue) {
      throw new Error("Queue names must be nonempty and distinct.");
    }
    if (batch.queue === extractionQueue) {
      return handleMemoryExtractionQueue(batch, requestEnv);
    }
    if (batch.queue === sourceQueue) {
      return handleSourceIngestionQueue(batch, requestEnv);
    }
    // Reject misconfigured delivery so the queue's retry/DLQ policy applies.
    throw new Error("Unrecognized queue name.");
  },
} satisfies ExportedHandler<Env>;

export async function handleMemoryExtractionQueue(
  batch: MessageBatch<unknown>,
  requestEnv: Env,
) {
  for (const message of batch.messages) {
    try {
      const body = parseMemoryExtractionMessage(message.body);
      if (requestEnv.MEMORY_EXTRACTION_WORKFLOW) {
        await startMemoryExtractionWorkflow(requestEnv, body);
      } else {
        await processMemoryExtractionMessage(requestEnv, body);
      }
      message.ack();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "openmemory.memory_extraction_error",
          memoryId: isRecord(message.body) ? message.body.memoryId : undefined,
          message: error instanceof Error ? error.message : "unknown error",
        }),
      );
      writeErrorAnalytics(requestEnv, {
        event: "openmemory.memory_extraction_error",
        message: error instanceof Error ? error.message : "unknown error",
      });
      message.retry({ delaySeconds: Math.min(300, 10 * message.attempts) });
    }
  }
}

export async function handleSourceIngestionQueue(
  batch: MessageBatch<unknown>,
  requestEnv: Env,
) {
  for (const message of batch.messages) {
    try {
      const body = parseSourceIngestionMessage(message.body);
      if (requestEnv.SOURCE_INGESTION_WORKFLOW) {
        await startSourceIngestionWorkflow(requestEnv, body);
      } else {
        await processSourceIngestionMessage(requestEnv, body);
      }
      message.ack();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "openmemory.source_ingestion_error",
          sourceId: isRecord(message.body) ? message.body.sourceId : undefined,
          message: error instanceof Error ? error.message : "unknown error",
        }),
      );
      writeErrorAnalytics(requestEnv, {
        event: "openmemory.source_ingestion_error",
        message: error instanceof Error ? error.message : "unknown error",
      });
      message.retry({ delaySeconds: Math.min(300, 10 * message.attempts) });
    }
  }
}

async function startMemoryExtractionWorkflow(
  requestEnv: Env,
  message: MemoryExtractionMessage,
) {
  try {
    await requestEnv.MEMORY_EXTRACTION_WORKFLOW?.create({
      id: await workflowInstanceId(
        "extract",
        message.tenantId,
        message.memoryId,
        message.generation ?? 0,
      ),
      params: message,
      retention: {
        successRetention: "7 days",
        errorRetention: "14 days",
      },
    });
  } catch (error) {
    if (!String(error).toLowerCase().includes("already")) {
      throw error;
    }
  }
}

function parseSourceIngestionMessage(value: unknown): IngestionQueueMessage {
  if (!isRecord(value)) {
    throw new Error("Invalid source ingestion queue message.");
  }
  if (
    typeof value.sourceId !== "string" ||
    !value.sourceId ||
    typeof value.tenantId !== "string" ||
    !normalizeTenantId(value.tenantId)
  ) {
    throw new Error("Source ingestion identifiers are required.");
  }
  const generation = parseWorkGeneration(value.generation);
  if (value.kind === "conversation") {
    return {
      kind: "conversation",
      version: 1,
      sourceId: value.sourceId,
      tenantId: value.tenantId,
      generation,
      input: IngestConversationSchema.parse(value.input),
      requestedAt:
        typeof value.requestedAt === "string"
          ? value.requestedAt
          : new Date().toISOString(),
    };
  }
  return {
    kind: "source",
    version: 1,
    sourceId: value.sourceId,
    tenantId: value.tenantId,
    generation,
    input: IngestSourceSchema.parse(value.input),
    requestedAt:
      typeof value.requestedAt === "string"
        ? value.requestedAt
        : new Date().toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function startSourceIngestionWorkflow(
  requestEnv: Env,
  message: IngestionQueueMessage,
) {
  const graph = getGraphForTenant(requestEnv, message.tenantId);
  const job = await graph.startIngestionJob(
    message.sourceId,
    message.generation ?? 0,
  );
  if (!job) return;
  try {
    await requestEnv.SOURCE_INGESTION_WORKFLOW?.create({
      id: await workflowInstanceId(
        "ingest",
        message.tenantId,
        message.sourceId,
        message.generation ?? 0,
      ),
      params: message,
      retention: {
        successRetention: "7 days",
        errorRetention: "14 days",
      },
    });
  } catch (error) {
    if (!String(error).toLowerCase().includes("already")) {
      throw error;
    }
  }
}

async function handleWorkerFetch(
  request: Request,
  requestEnv: Env,
  ctx: ExecutionContext,
) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const rateLimit = await checkGlobalRateLimit(request, requestEnv, startedAt);
  let response: Response;

  try {
    const pathname = new URL(request.url).pathname;

    if (request.method === "OPTIONS") {
      response = new Response(null);
    } else if (rateLimit.limited) {
      response = jsonResponse(
        {
          error: "rate_limited",
          message: "Too many requests. Try again after the retry window.",
          requestId,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 },
      );
    } else if (isAuthRoute(pathname)) {
      response = await handleOpenMemoryAuthRequest(requestEnv, request);
    } else if (isWorkspaceRoute(pathname)) {
      response = await handleWorkspaceRequest(requestEnv, request);
    } else if (pathname === "/mcp") {
      response = await mcpHandler(request, requestEnv, ctx);
    } else {
      if (pathname === "/v1/account" || pathname.startsWith("/v1/account/"))
        assertWorkspaceRequestOrigin(requestEnv, request);
      response = await apiWorker.fetch(request);
    }
  } catch (error) {
    response = jsonResponse(
      {
        error:
          error instanceof WorkspaceAccessError
            ? error.error
            : "internal_error",
        message: "OpenMemory could not complete the request.",
        requestId,
      },
      { status: error instanceof WorkspaceAccessError ? error.status : 500 },
    );
    console.error(
      JSON.stringify({
        event: "openmemory.request_error",
        requestId,
        message: error instanceof Error ? error.message : "unknown error",
      }),
    );
    writeErrorAnalytics(requestEnv, {
      event: "openmemory.request_error",
      message: error instanceof Error ? error.message : "unknown error",
      request,
    });
  }

  const finalized = await withCors(response, request, {
    requestId,
    rateLimit,
  });
  logRequest({
    durationMs: Date.now() - startedAt,
    rateLimited: rateLimit.limited,
    request,
    requestId,
    response: finalized,
  });
  writeRequestAnalytics(requestEnv, {
    durationMs: Date.now() - startedAt,
    rateLimited: rateLimit.limited,
    request,
    requestId,
    response: finalized,
  });

  return finalized;
}

async function withCors(
  response: Response | Promise<Response>,
  request: Request,
  options: { requestId: string; rateLimit: RateLimitResult },
) {
  const resolved = await response;
  const headers = new Headers(resolved.headers);
  if (new URL(request.url).pathname.startsWith("/v1/account"))
    headers.set("cache-control", "private, no-store");

  for (const [key, value] of corsHeaders(request)) {
    headers.set(key, value);
  }

  for (const [key, value] of Object.entries(options.rateLimit.headers)) {
    if (options.rateLimit.enabled) {
      headers.set(key, value);
    }
  }
  headers.set("x-openmemory-request-id", options.requestId);

  return new Response(resolved.body, {
    status: resolved.status,
    statusText: resolved.statusText,
    headers,
  });
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "*";

  return new Headers({
    "access-control-allow-credentials": "true",
    "access-control-allow-headers":
      "authorization, content-type, x-openmemory-user-id",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-origin": origin,
    vary: "Origin",
  });
}

const PAGE_STYLE = `
  :root { color-scheme: light; --bg:#f6f7f9; --panel:#ffffff; --ink:#18212f; --muted:#627085; --line:#dfe5ee; --accent:#0f766e; --danger:#991b1b; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--ink); }
  button, input, select, textarea { font: inherit; }
  header { min-height:64px; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:0 24px; border-bottom:1px solid var(--line); background:var(--panel); }
  h1 { font-size:20px; line-height:1.2; margin:0; }
  h2 { font-size:16px; margin:0 0 12px; }
  main { min-height:calc(100vh - 64px); }
  .app-shell { display:grid; grid-template-columns: 340px minmax(0, 1fr); }
  aside { border-right:1px solid var(--line); background:var(--panel); padding:20px; display:flex; flex-direction:column; gap:16px; }
  section { padding:20px; display:grid; grid-template-columns:minmax(0, 1fr) 380px; gap:18px; align-items:start; }
  label { display:block; font-size:12px; font-weight:700; color:#445166; margin-bottom:6px; }
  input, textarea, select { width:100%; border:1px solid #d8e0ea; border-radius:6px; padding:9px 10px; background:#fff; color:var(--ink); }
  textarea { min-height:140px; resize:vertical; }
  button { border:0; border-radius:6px; background:var(--accent); color:white; font-weight:700; padding:10px 12px; cursor:pointer; }
  button.secondary { background:#283443; }
  button.ghost { color:#283443; background:#eef2f7; }
  button:disabled { cursor:not-allowed; opacity:.55; }
  .stack { display:flex; flex-direction:column; gap:12px; }
  .row { display:flex; gap:8px; align-items:center; }
  .panel, .memory { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
  .memory { display:flex; flex-direction:column; gap:8px; }
  .meta { color:var(--muted); font-size:12px; display:flex; flex-wrap:wrap; gap:8px; }
  .pill { border:1px solid #d8e0ea; border-radius:999px; padding:2px 8px; background:#fff; }
  .list { display:flex; flex-direction:column; gap:10px; }
  .auth-card { width:min(420px, calc(100vw - 32px)); margin:8vh auto; }
  .error { border:1px solid #fecaca; border-radius:6px; background:#fff1f2; color:var(--danger); padding:10px; font-size:13px; }
  .hidden { display:none !important; }
  pre { white-space:pre-wrap; margin:0; color:#273444; line-height:1.5; }
  @media (max-width: 900px) { header { align-items:flex-start; flex-direction:column; padding:16px; } .app-shell, section { grid-template-columns:1fr; } aside { border-right:0; border-bottom:1px solid var(--line); } }
`;

const LOGIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenMemory Login</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <header><h1>OpenMemory</h1><a href="/">Dashboard</a></header>
  <main>
    <div class="panel auth-card stack">
      <h2>Sign in</h2>
      <p>Use your invited email address. No password needed.</p>
      <div id="error" role="alert" class="error hidden"></div>
      <p id="status" role="status">Checking sign-in availability…</p>
      <form id="authForm" class="stack">
        <div><label for="email">Email</label><input id="email" autocomplete="email" required type="email" /></div>
        <button id="sendCode" disabled type="submit">Send sign-in code</button>
      </form>
      <form id="verifyForm" class="stack" hidden>
        <div><label for="otp">Email code</label><input id="otp" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" minlength="6" required /></div>
        <button id="verifyCode" disabled type="submit">Verify and sign in</button>
      </form>
      <div id="providers" class="stack"></div>
    </div>
  </main>
  <script>
    const form = document.querySelector("#authForm");
    const verifyForm = document.querySelector("#verifyForm");
    const email = document.querySelector("#email");
    const otp = document.querySelector("#otp");
    const sendCode = document.querySelector("#sendCode");
    const verifyCode = document.querySelector("#verifyCode");
    const error = document.querySelector("#error");
    const status = document.querySelector("#status");
    const providers = document.querySelector("#providers");
    let sentEmail = "";
    let emailEnabled = false;
    let busy = false;
    function nextURL() {
      try {
        const next = new URL(new URLSearchParams(location.search).get("redirect") || "/", location.origin);
        if (next.origin === location.origin && !next.username && !next.password) return next.href;
      } catch {}
      return location.origin + "/";
    }
    function showError(message) { error.textContent = message; error.classList.remove("hidden"); }
    function setBusy(value) {
      busy = value;
      sendCode.disabled = value || !emailEnabled;
      verifyCode.disabled = value || !emailEnabled || !sentEmail;
      email.disabled = value;
    }
    async function auth(path, body) {
      const response = await fetch(path, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error("Sign-in could not be completed. Check your code or try again later.");
      return response.json();
    }
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (busy || !emailEnabled) return;
      setBusy(true);
      error.classList.add("hidden");
      sentEmail = "";
      otp.value = "";
      verifyForm.hidden = true;
      try {
        const requestedEmail = email.value.trim();
        await auth("/api/auth/email-otp/send-verification-otp", { email: requestedEmail, type: "sign-in" });
        sentEmail = requestedEmail;
        status.textContent = "If this address is eligible, a sign-in code has been sent. Check your inbox. Codes expire shortly.";
        verifyForm.hidden = false;
        sendCode.textContent = "Send another code";
      } catch { showError("Unable to send a sign-in code. Please try again later."); }
      finally { setBusy(false); }
    };
    email.oninput = () => { sentEmail = ""; otp.value = ""; verifyForm.hidden = true; setBusy(false); };
    verifyForm.onsubmit = async (event) => {
      event.preventDefault();
      if (busy || !emailEnabled || !sentEmail) return;
      setBusy(true);
      error.classList.add("hidden");
      try {
        await auth("/api/auth/sign-in/email-otp", { email: sentEmail, otp: otp.value });
        otp.value = "";
        location.href = nextURL();
      } catch { otp.value = ""; showError("Sign-in could not be completed. Check your code or request another."); }
      finally { setBusy(false); }
    };
    async function loadCapabilities() {
      try {
        const response = await fetch("/api/auth/capabilities", { credentials: "include" });
        if (!response.ok) throw new Error();
        const capabilities = await response.json();
        emailEnabled = capabilities.emailOTP === true;
        setBusy(false);
        status.textContent = emailEnabled ? "Private beta: sign-in is available to invited accounts." : "Email sign-in is currently unavailable. Contact your administrator.";
        for (const provider of ["google", "github"]) {
          if (!Array.isArray(capabilities.socialProviders) || !capabilities.socialProviders.includes(provider)) continue;
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = provider === "google" ? "Continue with Google" : "Continue with GitHub";
          button.onclick = async () => {
            if (busy) return;
            setBusy(true);
            error.classList.add("hidden");
            try {
              const result = await auth("/api/auth/sign-in/social", { provider, callbackURL: nextURL() });
              const target = new URL(result.url);
              if (target.protocol !== "https:") throw new Error();
              location.href = target.href;
            } catch { showError("Provider sign-in is currently unavailable. Please try again later."); }
            finally { setBusy(false); }
          };
          providers.appendChild(button);
        }
      } catch { status.textContent = "Sign-in is currently unavailable. Please try again later."; }
    }
    loadCapabilities();
  </script>
</body>
</html>`;

const CONSENT_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenMemory Consent</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <header><h1>OpenMemory</h1></header>
  <main>
    <div class="panel auth-card">
      <div class="stack">
        <h2>Authorize client</h2>
        <p class="meta" id="details"></p>
        <div id="error" class="error hidden"></div>
        <div class="row"><button id="approve">Allow</button><button id="deny" class="secondary">Deny</button></div>
      </div>
    </div>
  </main>
  <script>
    const params = new URLSearchParams(location.search);
    const scope = params.get("scope") || "";
    details.textContent = (params.get("client_id") || "This client") + " is requesting: " + (scope || "default OpenMemory access");
    function showError(message) { error.textContent = message; error.classList.remove("hidden"); }
    async function consent(accept) {
      const response = await fetch("/api/auth/oauth2/consent", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ accept, scope, oauth_query: location.search.slice(1) }) });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json().catch(() => ({}));
      if (data && data.url) location.href = data.url;
      else if (data && data.redirectURL) location.href = data.redirectURL;
      else location.href = "/";
    }
    approve.onclick = () => consent(true).catch((caught) => showError(caught.message));
    deny.onclick = () => consent(false).catch((caught) => showError(caught.message));
  </script>
</body>
</html>`;
