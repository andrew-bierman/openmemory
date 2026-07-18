import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

type BenchmarkRow = Record<string, unknown> & {
  commit?: string;
  generatedAt?: string;
  type?: string;
};

type NumericMetric = {
  direction: "higher" | "lower";
  label: string;
  thresholdField?: string;
};

const METRICS: Record<string, NumericMetric> = {
  recallElapsedMs: {
    direction: "lower",
    label: "Recall latency",
    thresholdField: "recallElapsedThresholdMs",
  },
  importElapsedMs: {
    direction: "lower",
    label: "Import latency",
  },
  meanReciprocalRank: {
    direction: "higher",
    label: "Mean reciprocal rank",
    thresholdField: "meanReciprocalRankThreshold",
  },
  hitAt3Rate: {
    direction: "higher",
    label: "Hit@3",
    thresholdField: "hitAt3Threshold",
  },
};

const args = process.argv.slice(2);

if (args.includes("--self-test")) {
  await runSelfTest();
  process.exit(0);
}

const { inputPaths, outPath } = parseArgs(args);
const rows = await readBenchmarkRows(inputPaths);
const report = renderTrendReport(rows, inputPaths);
await writeReport(outPath, report);
console.log(`Wrote benchmark trend summary to ${outPath}`);

function parseArgs(values: string[]) {
  const inputPaths: string[] = [];
  let outPath = ".tmp/benchmark-reports/benchmark-trend-summary.md";

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--out") {
      outPath =
        values[index + 1] ??
        fail("--out requires a destination markdown file path.");
      index += 1;
    } else if (value.startsWith("--out=")) {
      outPath = value.slice("--out=".length);
    } else if (value === "--") {
    } else {
      inputPaths.push(value);
    }
  }

  return {
    inputPaths,
    outPath,
  };
}

async function readBenchmarkRows(inputPaths: string[]) {
  const paths =
    inputPaths.length > 0
      ? inputPaths
      : await collectDefaultBenchmarkReports(".tmp/benchmark-reports");
  const rows: BenchmarkRow[] = [];

  for (const path of paths) {
    const resolvedPath = resolve(path);
    let content = "";
    try {
      content = await readFile(resolvedPath, "utf8");
    } catch {
      continue;
    }

    for (const [index, line] of content.split(/\r?\n/).entries()) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const row = JSON.parse(trimmed);
        if (isBenchmarkRow(row)) {
          rows.push(row);
        }
      } catch (error) {
        throw new Error(
          `Invalid JSONL row in ${resolvedPath}:${index + 1}: ${String(error)}`,
        );
      }
    }
  }

  return rows.sort((left, right) =>
    String(left.generatedAt ?? "").localeCompare(
      String(right.generatedAt ?? ""),
    ),
  );
}

async function collectDefaultBenchmarkReports(root: string) {
  const entries = await readdir(root, { recursive: true }).catch(() => []);
  return entries
    .map((entry) => join(root, String(entry)))
    .filter((entry) => entry.endsWith(".jsonl"));
}

function renderTrendReport(rows: BenchmarkRow[], inputPaths: string[]) {
  const generatedAt = new Date().toISOString();
  const lines = [
    "# Benchmark Trend Summary",
    "",
    `Generated at: ${generatedAt}`,
    `Rows analyzed: ${rows.length}`,
    `Inputs: ${inputPaths.length > 0 ? inputPaths.join(", ") : ".tmp/benchmark-reports/*.jsonl"}`,
    "",
  ];

  if (rows.length === 0) {
    lines.push("No benchmark rows were found.");
    return `${lines.join("\n")}\n`;
  }

  const groups = groupRowsByType(rows);
  for (const [type, typeRows] of Object.entries(groups).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const latest = typeRows.at(-1);
    lines.push(`## ${formatTitle(type)}`, "");
    lines.push(`Runs: ${typeRows.length}`);
    lines.push(`Latest: ${latest?.generatedAt ?? "unknown"}`);
    if (latest?.commit) {
      lines.push(`Commit: ${latest.commit}`);
    }
    lines.push("");

    for (const [field, metric] of Object.entries(METRICS)) {
      const values = typeRows
        .map((row) => numeric(row[field]))
        .filter((value): value is number => value !== null);
      if (values.length === 0) {
        continue;
      }

      const latestValue = values.at(-1) ?? 0;
      const previousValue = values.at(-2);
      const threshold = latest
        ? numeric(latest[metric.thresholdField ?? ""])
        : null;
      const thresholdStatus =
        threshold === null
          ? "not set"
          : passesThreshold(latestValue, threshold, metric.direction)
            ? "pass"
            : "fail";
      const delta =
        previousValue === undefined
          ? "first run"
          : formatDelta(latestValue - previousValue, metric.direction);

      lines.push(
        `- ${metric.label}: latest ${formatNumber(latestValue)}; average ${formatNumber(average(values))}; best ${formatNumber(best(values, metric.direction))}; worst ${formatNumber(worst(values, metric.direction))}; delta ${delta}; threshold ${threshold === null ? "n/a" : formatNumber(threshold)} (${thresholdStatus}).`,
      );
    }

    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function writeReport(outPath: string, report: string) {
  const resolvedOutPath = resolve(outPath);
  await writeFileWithParents(resolvedOutPath, report);
}

async function writeFileWithParents(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function isBenchmarkRow(value: unknown): value is BenchmarkRow {
  return typeof value === "object" && value !== null;
}

function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function best(values: number[], direction: NumericMetric["direction"]) {
  return direction === "higher" ? Math.max(...values) : Math.min(...values);
}

function worst(values: number[], direction: NumericMetric["direction"]) {
  return direction === "higher" ? Math.min(...values) : Math.max(...values);
}

function passesThreshold(
  value: number,
  threshold: number,
  direction: NumericMetric["direction"],
) {
  return direction === "higher" ? value >= threshold : value <= threshold;
}

function formatDelta(delta: number, direction: NumericMetric["direction"]) {
  const improved = direction === "higher" ? delta >= 0 : delta <= 0;
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${formatNumber(delta)} ${improved ? "improved" : "regressed"}`;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatTitle(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function groupRowsByType(rows: BenchmarkRow[]) {
  const groups: Record<string, BenchmarkRow[]> = {};
  for (const row of rows) {
    const type = String(row.type ?? "unknown");
    groups[type] = [...(groups[type] ?? []), row];
  }
  return groups;
}

function fail(message: string): never {
  throw new Error(message);
}

async function runSelfTest() {
  const root = await mkdtemp(join(tmpdir(), "openmemory-benchmark-trend-"));
  try {
    const input = join(root, "sample.jsonl");
    const output = join(root, "summary.md");
    await writeFile(
      input,
      [
        {
          generatedAt: "2026-07-18T00:00:00.000Z",
          type: "live-production-graph-scale",
          recallElapsedMs: 420,
          recallElapsedThresholdMs: 12_000,
          importElapsedMs: 900,
        },
        {
          generatedAt: "2026-07-18T01:00:00.000Z",
          type: "live-production-graph-scale",
          recallElapsedMs: 390,
          recallElapsedThresholdMs: 12_000,
          importElapsedMs: 870,
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );
    const report = renderTrendReport(await readBenchmarkRows([input]), [input]);
    await writeReport(output, report);
    if (!report.includes("Rows analyzed: 2")) {
      fail("Self-test report did not include row count.");
    }
    if (!report.includes("Recall latency: latest 390")) {
      fail("Self-test report did not include latest latency.");
    }
    if (!report.includes("-30 improved")) {
      fail("Self-test report did not include improvement delta.");
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}
