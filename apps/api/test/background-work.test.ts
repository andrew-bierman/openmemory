import { expect, test } from "vitest";
import {
  parseWorkGeneration,
  workflowInstanceId,
} from "../src/background-work";

test("workflow deduplication separates tenants and purge generations", async () => {
  const original = await workflowInstanceId("ingest", "tenant-a", "same-id", 0);
  expect(await workflowInstanceId("ingest", "tenant-a", "same-id", 0)).toBe(
    original,
  );
  for (const other of [
    workflowInstanceId("ingest", "tenant-b", "same-id", 0),
    workflowInstanceId("ingest", "tenant-a", "same-id", 1),
    workflowInstanceId("extract", "tenant-a", "same-id", 0),
  ])
    expect(await other).not.toBe(original);
  expect(await workflowInstanceId("ingest", "a:b", "c", 0)).not.toBe(
    await workflowInstanceId("ingest", "a", "b:c", 0),
  );
  expect(original.length).toBeLessThanOrEqual(100);
});

test("legacy generations are zero and invalid fences fail closed", () => {
  expect(parseWorkGeneration(undefined)).toBe(0);
  expect(parseWorkGeneration(2)).toBe(2);
  for (const value of [
    null,
    -1,
    0.5,
    "1",
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    expect(() => parseWorkGeneration(value)).toThrow();
  }
});
