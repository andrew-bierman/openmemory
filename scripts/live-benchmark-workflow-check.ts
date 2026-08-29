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
    label: "caps downloaded benchmark artifact size",
    snippet: "MAX_ARTIFACT_BYTES=1048576",
  },
  {
    label: "checks artifact size before downloading historical evidence",
    snippet: ".size_in_bytes",
  },
  {
    label: "restores only current-run JSONL evidence from historical artifacts",
    snippet: "-name 'live-production.jsonl'",
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
    label: "uploads the markdown benchmark summary explicitly",
    snippet: ".tmp/benchmark-reports/live-production-summary.md",
  },
];

const forbiddenSnippets = [
  {
    label: "recursive wildcard artifact upload",
    snippet: "path: .tmp/benchmark-reports/*",
    scope: "upload",
  },
  {
    label: "history directory under the artifact upload directory",
    snippet: "mkdir -p .tmp/benchmark-reports/history",
    scope: "workflow",
  },
  {
    label: "history artifact upload",
    snippet: ".tmp/benchmark-reports/live-production-history.jsonl",
    scope: "upload",
  },
  {
    label: "trend input artifact upload",
    snippet: ".tmp/benchmark-reports/live-production-trend.jsonl",
    scope: "upload",
  },
];

const failures: string[] = [];

for (const requirement of requiredSnippets) {
  if (!workflow.includes(requirement.snippet)) {
    failures.push(`Missing ${requirement.label}: ${requirement.snippet}`);
  }
}

for (const forbidden of forbiddenSnippets) {
  const haystack =
    forbidden.scope === "upload" ? uploadBlock(workflow) : workflow;
  if (haystack.includes(forbidden.snippet)) {
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

function uploadBlock(value: string): string {
  return (
    value.match(
      /- name: Upload benchmark report[\s\S]*?(?=\n\s+- name:|\n\s*[A-Za-z_-]+:|$)/,
    )?.[0] ?? ""
  );
}
