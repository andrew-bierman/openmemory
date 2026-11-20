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
    };
    const graph = env.GRAPHS.get(env.GRAPHS.idFromName(body.tenant));
    try {
      let result: unknown;
      switch (body.operation) {
        case "generation":
          result = await graph.getIngestionGeneration();
          break;
        case "create":
          result = await graph.createMemory(body.input, body.generation);
          break;
        case "edge":
          result = await graph.addEdge(body.input, body.generation);
          break;
        case "job":
          result = await graph.createIngestionJob({
            sourceId: body.sourceId ?? "",
            input: body.input,
          });
          break;
        case "start":
          result = await graph.startIngestionJob(
            body.sourceId ?? "",
            body.generation,
          );
          break;
        case "complete":
          result = await graph.completeIngestionJob(
            body.sourceId ?? "",
            body.input,
            body.generation,
          );
          break;
        case "fail":
          result = await graph.failIngestionJob(
            body.sourceId ?? "",
            body.input,
            body.generation,
          );
          break;
        case "get-job":
          result = await graph.getIngestionJob(body.sourceId ?? "");
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
        case "extract":
          result = await graph.applyExtractedSignals(
            body.sourceId ?? "",
            body.input as Parameters<MemoryGraph["applyExtractedSignals"]>[1],
            body.generation,
          );
          break;
        case "stats":
          result = await graph.getStats();
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
