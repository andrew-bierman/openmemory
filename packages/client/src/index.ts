import { treaty } from "@elysia/eden";
import type { App } from "@openmemory/api";

export type OpenMemoryClientOptions = {
  tenantId: string;
  token?: string;
  fetch?: typeof fetch;
};

export function createOpenMemoryClient(
  baseUrl: string,
  options: OpenMemoryClientOptions,
) {
  return treaty<App>(baseUrl, {
    fetcher: options.fetch,
    headers: {
      "x-openmemory-user-id": options.tenantId,
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
  });
}
