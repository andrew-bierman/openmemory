type QueryRow = Record<string, unknown>;

type AlertStatus = "pass" | "breach" | "no_data";

type AlertResult = {
  name: string;
  status: AlertStatus;
  severity: "warning" | "critical";
  value: number;
  threshold: number;
  details: string;
};

type AlertRule = {
  name: string;
  severity: "warning" | "critical";
  sql: (dataset: string, config: AlertConfig) => string;
  evaluate: (rows: QueryRow[], config: AlertConfig) => AlertResult;
};

type AlertConfig = {
  accountId: string;
  apiToken: string;
  dataset: string;
  minRequests: number;
  fetcher: typeof fetch;
};

const DEFAULT_DATASET = "openmemory_events";
const DEFAULT_MIN_REQUESTS = 20;

const rules: AlertRule[] = [
  {
    name: "request_errors",
    severity: "critical",
    sql: (dataset) => `
SELECT
  SUM(_sample_interval) AS errors
FROM ${dataset}
WHERE timestamp >= NOW() - INTERVAL '5' MINUTE
  AND blob1 = 'openmemory.request_error'
FORMAT JSON`,
    evaluate: (rows) => {
      const errors = metric(rows, "errors");
      return thresholdResult({
        name: "request_errors",
        severity: "critical",
        value: errors,
        threshold: 0,
        breached: errors > 0,
        details: `${errors} request errors in the last 5 minutes`,
      });
    },
  },
  {
    name: "async_worker_failures",
    severity: "critical",
    sql: (dataset) => `
SELECT
  SUM(_sample_interval) AS failures
FROM ${dataset}
WHERE timestamp >= NOW() - INTERVAL '5' MINUTE
  AND blob1 IN (
    'openmemory.source_ingestion_error',
    'openmemory.memory_extraction_error'
  )
FORMAT JSON`,
    evaluate: (rows) => {
      const failures = metric(rows, "failures");
      return thresholdResult({
        name: "async_worker_failures",
        severity: "critical",
        value: failures,
        threshold: 0,
        breached: failures > 0,
        details: `${failures} async worker failures in the last 5 minutes`,
      });
    },
  },
  {
    name: "five_xx_rate",
    severity: "critical",
    sql: (dataset) => `
SELECT
  SUM(_sample_interval) AS requests,
  SUM(IF(blob4 = '5xx', _sample_interval, 0)) AS five_xx
FROM ${dataset}
WHERE timestamp >= NOW() - INTERVAL '5' MINUTE
  AND blob1 = 'openmemory.request'
FORMAT JSON`,
    evaluate: (rows, config) => {
      const requests = metric(rows, "requests");
      const fiveXx = metric(rows, "five_xx");
      const rate = requests > 0 ? fiveXx / requests : 0;
      return thresholdResult({
        name: "five_xx_rate",
        severity: "critical",
        value: rate,
        threshold: 0.02,
        breached: requests >= config.minRequests && rate > 0.02,
        details: `${formatPercent(rate)} 5xx rate over ${requests} requests in the last 5 minutes`,
      });
    },
  },
  {
    name: "rate_limit_rate",
    severity: "warning",
    sql: (dataset) => `
SELECT
  SUM(_sample_interval) AS requests,
  SUM(IF(blob6 = 'true', _sample_interval, 0)) AS rate_limited
FROM ${dataset}
WHERE timestamp >= NOW() - INTERVAL '10' MINUTE
  AND blob1 = 'openmemory.request'
FORMAT JSON`,
    evaluate: (rows, config) => {
      const requests = metric(rows, "requests");
      const rateLimited = metric(rows, "rate_limited");
      const rate = requests > 0 ? rateLimited / requests : 0;
      return thresholdResult({
        name: "rate_limit_rate",
        severity: "warning",
        value: rate,
        threshold: 0.05,
        breached: requests >= config.minRequests && rate > 0.05,
        details: `${formatPercent(rate)} rate-limited responses over ${requests} requests in the last 10 minutes`,
      });
    },
  },
  {
    name: "graph_rag_p95_latency",
    severity: "warning",
    sql: (dataset) => `
SELECT
  blob3 AS path,
  quantileExactWeighted(0.95)(double2, _sample_interval) AS p95_duration_ms
FROM ${dataset}
WHERE timestamp >= NOW() - INTERVAL '10' MINUTE
  AND blob1 = 'openmemory.request'
  AND blob3 IN (
    '/v1/search',
    '/v1/context',
    '/v1/graph/stats',
    '/v1/sources',
    '/v1/sources/async',
    '/mcp'
  )
GROUP BY path
ORDER BY p95_duration_ms DESC
LIMIT 1
FORMAT JSON`,
    evaluate: (rows) => {
      const p95 = metric(rows, "p95_duration_ms");
      const path = stringMetric(rows, "path") || "no route data";
      return thresholdResult({
        name: "graph_rag_p95_latency",
        severity: "warning",
        value: p95,
        threshold: 2000,
        breached: p95 > 2000,
        details: `${path} p95 latency is ${p95}ms in the last 10 minutes`,
      });
    },
  },
];

async function main() {
  const args = new Set(Bun.argv.slice(2));
  if (args.has("--self-test")) {
    runSelfTest();
    return;
  }

  const config = runtimeConfig();
  const results = await Promise.all(
    rules.map(async (rule) =>
      rule.evaluate(await queryAnalytics(rule, config), config),
    ),
  );
  printResults(results);

  if (results.some((result) => result.status === "breach")) {
    process.exitCode = 1;
  }
}

function runtimeConfig(): AlertConfig {
  const accountId = mustEnv("CLOUDFLARE_ACCOUNT_ID");
  const apiToken =
    process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN ?? "";
  if (!apiToken) {
    throw new Error("Missing CLOUDFLARE_API_TOKEN or CF_API_TOKEN");
  }
  return {
    accountId,
    apiToken,
    dataset: sqlIdentifier(
      process.env.OPENMEMORY_ANALYTICS_DATASET ?? DEFAULT_DATASET,
    ),
    minRequests: numberEnv(
      "OPENMEMORY_ALERT_MIN_REQUESTS",
      DEFAULT_MIN_REQUESTS,
    ),
    fetcher: fetch,
  };
}

async function queryAnalytics(rule: AlertRule, config: AlertConfig) {
  const response = await config.fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/analytics_engine/sql`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiToken}`,
        "content-type": "text/plain",
      },
      body: rule.sql(config.dataset, config),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${rule.name} query failed with ${response.status}: ${text.slice(0, 500)}`,
    );
  }
  return parseRows(text);
}

function parseRows(text: string): QueryRow[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.filter(isRecord);
  }
  if (isRecord(parsed) && Array.isArray(parsed.data)) {
    return parsed.data.filter(isRecord);
  }
  if (isRecord(parsed)) {
    return [parsed];
  }
  return [];
}

function thresholdResult(input: {
  name: string;
  severity: "warning" | "critical";
  value: number;
  threshold: number;
  breached: boolean;
  details: string;
}): AlertResult {
  return {
    name: input.name,
    severity: input.severity,
    value: input.value,
    threshold: input.threshold,
    status: input.breached ? "breach" : "pass",
    details: input.details,
  };
}

function metric(rows: QueryRow[], key: string) {
  const value = rows.length > 0 ? rows[0]?.[key] : 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function stringMetric(rows: QueryRow[], key: string) {
  const value = rows.length > 0 ? rows[0]?.[key] : undefined;
  return typeof value === "string" ? value : undefined;
}

function printResults(results: AlertResult[]) {
  for (const result of results) {
    console.log(
      `${result.status.toUpperCase()} ${result.name}: ${result.details} (threshold ${formatThreshold(result)})`,
    );
  }
}

function formatThreshold(result: AlertResult) {
  return result.name.endsWith("_rate")
    ? formatPercent(result.threshold)
    : String(result.threshold);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function numberEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function sqlIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(
      `Invalid OPENMEMORY_ANALYTICS_DATASET: expected a SQL identifier, got ${value}`,
    );
  }
  return value;
}

function runSelfTest() {
  const config: AlertConfig = {
    accountId: "test-account",
    apiToken: "test-token",
    dataset: DEFAULT_DATASET,
    minRequests: 20,
    fetcher: fetch,
  };
  const byName = new Map(rules.map((rule) => [rule.name, rule]));
  const cases: Array<{
    name: string;
    rows: QueryRow[];
    expected: AlertStatus;
  }> = [
    { name: "request_errors", rows: [{ errors: 1 }], expected: "breach" },
    { name: "request_errors", rows: [{ errors: 0 }], expected: "pass" },
    {
      name: "async_worker_failures",
      rows: [{ failures: 2 }],
      expected: "breach",
    },
    {
      name: "five_xx_rate",
      rows: [{ requests: 100, five_xx: 3 }],
      expected: "breach",
    },
    {
      name: "five_xx_rate",
      rows: [{ requests: 10, five_xx: 10 }],
      expected: "pass",
    },
    {
      name: "rate_limit_rate",
      rows: [{ requests: 100, rate_limited: 6 }],
      expected: "breach",
    },
    {
      name: "graph_rag_p95_latency",
      rows: [{ path: "/mcp", p95_duration_ms: 2100 }],
      expected: "breach",
    },
    {
      name: "graph_rag_p95_latency",
      rows: [{ path: "/mcp", p95_duration_ms: 500 }],
      expected: "pass",
    },
  ];

  for (const testCase of cases) {
    const rule = byName.get(testCase.name);
    if (!rule) {
      throw new Error(`Missing self-test rule: ${testCase.name}`);
    }
    const result = rule.evaluate(testCase.rows, config);
    if (result.status !== testCase.expected) {
      throw new Error(
        `${testCase.name} expected ${testCase.expected}, got ${result.status}`,
      );
    }
  }

  const parsed = parseRows('{"data":[{"errors":"2"}],"rows":1}');
  if (metric(parsed, "errors") !== 2) {
    throw new Error("Cloudflare FORMAT JSON parser self-test failed");
  }
  try {
    sqlIdentifier("openmemory_events; DROP TABLE openmemory_events");
    throw new Error("SQL identifier validation self-test failed");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.startsWith("Invalid OPENMEMORY_ANALYTICS_DATASET")
    ) {
      throw error;
    }
  }
  console.log(`Observability alert self-test passed (${cases.length} cases).`);
}

function isRecord(value: unknown): value is QueryRow {
  return typeof value === "object" && value !== null;
}

await main();

export {};
