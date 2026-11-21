import type { Env } from "../../src/env";
import { MemoryGraph } from "../../src/memory-graph";

export { MemoryGraph };

// Local test entrypoint only; neither production Wrangler configuration imports it.
export default {
  async fetch(request: Request, env: { GRAPHS: Env["MEMORY_GRAPHS"] }) {
    if (new URL(request.url).pathname === "/health") return new Response("ok");
    const body = (await request.json()) as {
      tenant: string;
      operation: string;
      input?: unknown;
      generation?: number;
      sourceId?: string;
      shareId?: string;
      workspaceId?: string;
    };
    const graph = env.GRAPHS.get(env.GRAPHS.idFromName(body.tenant));
    try {
      let result: unknown;
      switch (body.operation) {
        case "share":
          result = await graph.createMemoryShare(
            body.input as Parameters<MemoryGraph["createMemoryShare"]>[0],
          );
          break;
        case "read-share":
          result = await graph.readMemoryShare(
            body.shareId ?? "",
            body.workspaceId ?? "",
          );
          break;
        case "revoke-share":
          result = await graph.revokeMemoryShare(
            body.shareId ?? "",
            body.workspaceId ?? "",
          );
          break;
        case "update":
          result = await graph.updateMemory(body.sourceId ?? "", body.input);
          break;
        case "forget":
          result = await graph.forgetMemory(body.sourceId ?? "", {});
          break;
        case "merge":
          result = await graph.mergeGraph(body.input, "overwrite");
          break;
        case "generation":
          result = await graph.getIngestionGeneration();
          break;
        case "create":
          result = await graph.createMemory(body.input, body.generation);
          break;
        case "edge":
          result = await graph.addEdge(body.input, body.generation);
          break;
        case "purge":
          result = await graph.purgeTenantData();
          break;
        case "list":
          result = await graph.listMemories(100);
          break;
        case "retire":
          result = await graph.purgeTenantData(true);
          break;
        case "export":
          result = await graph.exportGraph();
          break;
        case "restore":
          result = await graph.restoreGraph(body.input);
          break;
        default:
          return new Response("Unknown test operation", { status: 400 });
      }
      return Response.json(result ?? null);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 409 },
      );
    }
  },
};
