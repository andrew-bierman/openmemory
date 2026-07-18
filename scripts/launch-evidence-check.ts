import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type LaunchEvidence = {
  benchmarkEvidence: {
    liveBenchmarkRun: string;
    releaseValidationCommit: string;
  };
  documentedRepositoryGate: {
    commit: string;
    mainCiRun: string;
    workersBuildUrl: string;
  };
  latestVerifiedRuntimeCandidate: {
    commit: string;
    liveSmokeRun: string;
    remoteCleanupCounters: Record<string, number>;
  };
  screenshotDirectory: string;
};

const evidencePath = resolve("config/launch-evidence.json");
const launchReadinessPath = resolve("docs/launch-readiness.md");
const releaseQualificationPath = resolve("docs/release-qualification.md");

const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
assertEvidence(evidence);

const launchReadiness = await readFile(launchReadinessPath, "utf8");
const releaseQualification = await readFile(releaseQualificationPath, "utf8");

assertIncludes(
  launchReadiness,
  evidence.documentedRepositoryGate.commit,
  "docs/launch-readiness.md must mention the documented repository-gate commit.",
);
assertIncludes(
  launchReadiness,
  evidence.documentedRepositoryGate.mainCiRun,
  "docs/launch-readiness.md must mention the documented main CI run.",
);
assertIncludes(
  launchReadiness,
  evidence.documentedRepositoryGate.workersBuildUrl,
  "docs/launch-readiness.md must mention the documented Workers Build URL.",
);
assertIncludes(
  launchReadiness,
  evidence.latestVerifiedRuntimeCandidate.commit,
  "docs/launch-readiness.md must mention the latest verified runtime candidate commit.",
);
assertIncludes(
  launchReadiness,
  evidence.latestVerifiedRuntimeCandidate.liveSmokeRun,
  "docs/launch-readiness.md must mention the latest live-smoke run.",
);
assertIncludes(
  launchReadiness,
  evidence.benchmarkEvidence.releaseValidationCommit,
  "docs/launch-readiness.md must mention the release-validation commit.",
);
assertIncludes(
  launchReadiness,
  evidence.benchmarkEvidence.liveBenchmarkRun,
  "docs/launch-readiness.md must mention the hosted benchmark run.",
);
assertIncludes(
  releaseQualification,
  evidence.screenshotDirectory,
  "docs/release-qualification.md must mention the screenshot evidence directory.",
);

for (const [name, count] of Object.entries(
  evidence.latestVerifiedRuntimeCandidate.remoteCleanupCounters,
)) {
  assert(
    Number.isInteger(count) && count >= 0,
    `Cleanup counter ${name} must be a non-negative integer.`,
  );
  assertIncludes(
    launchReadiness,
    `${name}=${count}`,
    `docs/launch-readiness.md must mention cleanup counter ${name}=${count}.`,
  );
}

console.log(
  `Launch evidence is documented for repo ${evidence.documentedRepositoryGate.commit.slice(
    0,
    7,
  )} and runtime ${evidence.latestVerifiedRuntimeCandidate.commit.slice(0, 7)}.`,
);

function assertEvidence(value: unknown): asserts value is LaunchEvidence {
  assert(
    typeof value === "object" && value !== null,
    "Launch evidence must be an object.",
  );
  const evidence = value as Partial<LaunchEvidence>;
  assert(
    typeof evidence.documentedRepositoryGate === "object" &&
      evidence.documentedRepositoryGate !== null,
    "documentedRepositoryGate is required.",
  );
  assert(
    /^[0-9a-f]{40}$/.test(String(evidence.documentedRepositoryGate.commit)),
    "documentedRepositoryGate.commit must be a full Git SHA.",
  );
  assert(
    /^\d+$/.test(String(evidence.documentedRepositoryGate.mainCiRun)),
    "documentedRepositoryGate.mainCiRun must be a GitHub run id.",
  );
  assert(
    typeof evidence.documentedRepositoryGate.workersBuildUrl === "string" &&
      evidence.documentedRepositoryGate.workersBuildUrl.startsWith("https://"),
    "documentedRepositoryGate.workersBuildUrl must be a URL.",
  );
  assert(
    typeof evidence.latestVerifiedRuntimeCandidate === "object" &&
      evidence.latestVerifiedRuntimeCandidate !== null,
    "latestVerifiedRuntimeCandidate is required.",
  );
  assert(
    /^[0-9a-f]{40}$/.test(
      String(evidence.latestVerifiedRuntimeCandidate.commit),
    ),
    "latestVerifiedRuntimeCandidate.commit must be a full Git SHA.",
  );
  assert(
    /^\d+$/.test(String(evidence.latestVerifiedRuntimeCandidate.liveSmokeRun)),
    "latestVerifiedRuntimeCandidate.liveSmokeRun must be a GitHub run id.",
  );
  assert(
    typeof evidence.latestVerifiedRuntimeCandidate.remoteCleanupCounters ===
      "object" &&
      evidence.latestVerifiedRuntimeCandidate.remoteCleanupCounters !== null,
    "latestVerifiedRuntimeCandidate.remoteCleanupCounters is required.",
  );
  assert(
    typeof evidence.benchmarkEvidence === "object" &&
      evidence.benchmarkEvidence !== null,
    "benchmarkEvidence is required.",
  );
  assert(
    /^[0-9a-f]{40}$/.test(
      String(evidence.benchmarkEvidence.releaseValidationCommit),
    ),
    "benchmarkEvidence.releaseValidationCommit must be a full Git SHA.",
  );
  assert(
    /^\d+$/.test(String(evidence.benchmarkEvidence.liveBenchmarkRun)),
    "benchmarkEvidence.liveBenchmarkRun must be a GitHub run id.",
  );
  assert(
    typeof evidence.screenshotDirectory === "string" &&
      evidence.screenshotDirectory.length > 0,
    "screenshotDirectory is required.",
  );
}

function assertIncludes(haystack: string, needle: string, message: string) {
  assert(haystack.includes(needle), message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
