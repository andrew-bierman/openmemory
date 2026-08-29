import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflowPath = resolve(".github/workflows/live-benchmark.yml");
const workflow = readFileSync(workflowPath, "utf8");

const requiredSnippets = [
  {
    label: "stores downloaded history outside the artifact upload directory",
    snippet: "$RUNNER_TEMP/openmemory-benchmark-history",
  },
  {
    label: "prunes nested historical artifacts before flattening JSONL rows",
    snippet: "-path '*/history/*' -prune",
  },
  {
    label: "creates the trend input before optional appends",
    snippet: ": > .tmp/benchmark-reports/live-production-trend.jsonl",
  },
  {
    label: "uploads the current live benchmark report explicitly",
    snippet: ".tmp/benchmark-reports/live-production.jsonl",
  },
  {
    label: "uploads the flattened trend report explicitly",
    snippet: ".tmp/benchmark-reports/live-production-trend.jsonl",
  },
  {
    label: "uploads the markdown benchmark summary explicitly",
    snippet: ".tmp/benchmark-reports/live-production-summary.md",
  },
];

const forbiddenSnippets = [
  {
    label: "recursive wildcard artifact upload",
    snippet: "path: .tmp/benchmark-reports/*",
  },
  {
    label: "history directory under the artifact upload directory",
    snippet: "mkdir -p .tmp/benchmark-reports/history",
  },
];

const failures: string[] = [];

for (const requirement of requiredSnippets) {
  if (!workflow.includes(requirement.snippet)) {
    failures.push(`Missing ${requirement.label}: ${requirement.snippet}`);
  }
}

for (const forbidden of forbiddenSnippets) {
  if (workflow.includes(forbidden.snippet)) {
    failures.push(`Found ${forbidden.label}: ${forbidden.snippet}`);
  }
}

if (failures.length > 0) {
  console.error("Live benchmark workflow regression check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Live benchmark workflow avoids recursive artifact growth.");
