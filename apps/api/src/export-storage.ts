import type { Env } from "./env";

export type TenantExportCleanupResult = {
  r2Configured: boolean;
  prefix: string;
  attempted: number;
  deleted: number;
  failed: number;
  error?: string;
};

export function tenantExportPrefix(tenantId: string) {
  return `${tenantId}/exports/`;
}

export async function deleteTenantExports(
  env: Env,
  tenantId: string,
): Promise<TenantExportCleanupResult> {
  const prefix = tenantExportPrefix(tenantId);
  if (!env.MEMORY_EXPORTS) {
    return {
      r2Configured: false,
      prefix,
      attempted: 0,
      deleted: 0,
      failed: 0,
    };
  }

  let attempted = 0;
  let deleted = 0;
  let cursor: string | undefined;

  try {
    do {
      const listed = await env.MEMORY_EXPORTS.list({ prefix, cursor });
      const keys = listed.objects.map((object) => object.key);
      attempted += keys.length;

      if (keys.length > 0) {
        await env.MEMORY_EXPORTS.delete(keys);
        deleted += keys.length;
      }

      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    return {
      r2Configured: true,
      prefix,
      attempted,
      deleted,
      failed: attempted - deleted,
    };
  } catch (error) {
    return {
      r2Configured: true,
      prefix,
      attempted,
      deleted,
      failed: Math.max(attempted - deleted, 1),
      error: error instanceof Error ? error.message : "unknown_r2_delete_error",
    };
  }
}
