// Legacy deliveries belong only to the initial generation, never a new tenant state.
export function parseWorkGeneration(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid background work generation.");
  }
  return value;
}

export async function workflowInstanceId(
  kind: "extract" | "ingest",
  tenantId: string,
  resourceId: string,
  generation: number,
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([tenantId, resourceId, parseWorkGeneration(generation)]),
    ),
  );
  return `${kind}-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
