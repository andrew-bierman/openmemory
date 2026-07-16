import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type Finding = {
  column: number;
  line: number;
  path: string;
  rule: string;
};

type Rule = {
  allow?: RegExp[];
  name: string;
  pattern: RegExp;
};

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  ".turbo",
  ".wrangler",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const ignoredFileExtensions = new Set([
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".webp",
]);
const ignoredFiles = new Set(["bun.lock"]);

const placeholderValue =
  /(example|placeholder|changeme|change-me|test|fake|dummy|redacted|your-|<[^>]+>)/i;
const documentedSecretName =
  /\b[A-Z0-9_]*(SECRET|TOKEN|API_KEY|CLIENT_SECRET|PRIVATE_KEY)[A-Z0-9_]*\b/;

const rules: Rule[] = [
  {
    name: "private-key-block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  },
  {
    name: "openai-api-key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
  },
  {
    name: "github-token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/,
  },
  {
    name: "cloudflare-api-token",
    pattern:
      /\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*[:=]\s*["']?([A-Za-z0-9_-]{40,})/i,
    allow: [placeholderValue],
  },
  {
    name: "secret-assignment",
    pattern:
      /\b[A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|CLIENT_SECRET|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*["']?([^"'\s#]{8,})/,
    allow: [placeholderValue, documentedSecretName],
  },
];

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  runSecretScan();
}

function runSecretScan() {
  const findings: Finding[] = [];

  for (const path of walk(root)) {
    findings.push(...scanFile(path));
  }

  if (findings.length > 0) {
    console.error(
      "Potential secrets found. Remove the value or add a narrow allow rule if this is a false positive.",
    );
    for (const finding of findings) {
      console.error(
        `${finding.path}:${finding.line}:${finding.column} ${finding.rule}`,
      );
    }
    process.exit(1);
  }

  console.log("Secret scan passed.");
}

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) {
      continue;
    }

    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      yield* walk(path);
    } else if (stats.isFile() && shouldScan(path)) {
      yield path;
    }
  }
}

function shouldScan(path: string) {
  const relativePath = relative(root, path);
  if (ignoredFiles.has(relativePath)) {
    return false;
  }

  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
  return !ignoredFileExtensions.has(extension);
}

function scanFile(path: string) {
  const relativePath = relative(root, path);
  const contents = readFileSync(path, "utf8");
  if (contents.includes("\0")) {
    return [];
  }

  const findings: Finding[] = [];
  const lines = contents.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    findings.push(...scanLine(line, relativePath, index + 1));
  }

  return findings;
}

function scanLine(line: string, path: string, lineNumber: number) {
  const findings: Finding[] = [];
  for (const rule of rules) {
    const match = line.match(rule.pattern);
    if (!match || isAllowed(line, rule)) {
      continue;
    }

    findings.push({
      column: (match.index ?? 0) + 1,
      line: lineNumber,
      path,
      rule: rule.name,
    });
  }

  return findings;
}

function isAllowed(line: string, rule: Rule) {
  return rule.allow?.some((allow) => allow.test(line)) ?? false;
}

function runSelfTest() {
  const openAiKey = `sk-${"a".repeat(40)}`;
  const githubToken = `ghp_${"A".repeat(36)}`;
  const cloudflareToken = `CLOUDFLARE_API_TOKEN=${"a".repeat(40)}`;
  const privateKey = `-----BEGIN ${"PRIVATE"} KEY-----`;
  const placeholder = "CLOUDFLARE_API_TOKEN=<account-token>";
  const camelCaseRuntimeValue = "const accessToken = authorization;";

  const cases = [
    { expected: true, line: openAiKey, name: "OpenAI key" },
    { expected: true, line: githubToken, name: "GitHub token" },
    {
      expected: true,
      line: cloudflareToken,
      name: "Cloudflare token assignment",
    },
    { expected: true, line: privateKey, name: "private key block" },
    { expected: false, line: placeholder, name: "placeholder token" },
    {
      expected: false,
      line: camelCaseRuntimeValue,
      name: "runtime token variable",
    },
  ];

  for (const testCase of cases) {
    const found = scanLine(testCase.line, "self-test", 1).length > 0;
    if (found !== testCase.expected) {
      console.error(
        `Secret scan self-test failed for ${testCase.name}: expected ${testCase.expected}, got ${found}`,
      );
      process.exit(1);
    }
  }

  console.log("Secret scan self-test passed.");
}
