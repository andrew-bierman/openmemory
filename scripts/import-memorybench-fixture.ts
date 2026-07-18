#!/usr/bin/env bun
import { importBenchmarkFixture } from "@openmemory/core";

const usage = `Usage:
  bun scripts/import-memorybench-fixture.ts <input.json|input.jsonl> --out <graph-export.json>

Input JSON may be an object with memories, distractors, cases, and edges.
JSONL input must use one object per line with kind: "memory", "distractor", "case", or "edge".`;

const args = process.argv.slice(2);
const inputPath = args[0];
const outputPath = readFlag(args, "--out");

if (!inputPath || !outputPath || args.includes("--help")) {
  console.error(usage);
  process.exit(inputPath && args.includes("--help") ? 0 : 1);
}

const inputText = await Bun.file(inputPath).text();
const fixture = parseFixture(inputText, inputPath);
const imported = importBenchmarkFixture(fixture);
await Bun.write(
  outputPath,
  `${JSON.stringify(imported.graphExport, null, 2)}\n`,
);

console.log(
  [
    `Imported ${imported.graphExport.memories.length} memories`,
    `${imported.graphExport.edges.length} edges`,
    `${imported.cases.length} recall cases`,
    `Wrote ${outputPath}`,
  ].join("; "),
);

function readFlag(values: string[], flag: string) {
  const index = values.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return values[index + 1];
}

function parseFixture(inputText: string, path: string) {
  if (path.endsWith(".jsonl")) {
    return parseJsonlFixture(inputText);
  }
  return JSON.parse(inputText);
}

function parseJsonlFixture(inputText: string) {
  const fixture = {
    version: 1,
    name: "memorybench-jsonl-fixture",
    memories: [] as unknown[],
    distractors: [] as unknown[],
    cases: [] as unknown[],
    edges: [] as unknown[],
  };

  for (const [index, line] of inputText.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const row = JSON.parse(trimmed) as Record<string, unknown>;
    switch (row.kind) {
      case "memory":
        fixture.memories.push(stripKind(row));
        break;
      case "distractor":
        fixture.distractors.push(stripKind(row));
        break;
      case "case":
        fixture.cases.push(stripKind(row));
        break;
      case "edge":
        fixture.edges.push(stripKind(row));
        break;
      default:
        throw new Error(
          `Unsupported JSONL kind on line ${index + 1}: ${row.kind}`,
        );
    }
  }

  return fixture;
}

function stripKind(row: Record<string, unknown>) {
  const { kind: _kind, ...rest } = row;
  return rest;
}
