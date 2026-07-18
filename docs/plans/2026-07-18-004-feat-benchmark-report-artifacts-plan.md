---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
created: 2026-07-18
title: Benchmark Report Artifacts
---

# Benchmark Report Artifacts

## Goal Capsule

OpenMemory has recall and graph-scale benchmarks, but release reviewers need
durable benchmark evidence instead of only pass/fail logs. Emit structured JSONL
benchmark reports from the existing integration benchmark tests and upload them
from the manual release-qualification workflow.

## Product Contract

### Requirements

- R1. Existing benchmark assertions must stay authoritative; report generation
  must not weaken thresholds or hide failures.
- R2. Local benchmark scripts must write ignored JSONL evidence under
  `.tmp/benchmark-reports/`.
- R3. Report rows must include enough fields for release comparison: timestamp,
  commit when available, benchmark type, graph size or case count, measured
  value, and asserted threshold.
- R4. The manual `Release Qualification` workflow must upload benchmark reports
  as an artifact even when a gate fails.
- R5. README, release qualification, launch readiness, and roadmap docs must
  describe where benchmark evidence lives and what gap still remains.

### Acceptance Examples

- AE1. Running `bun run test:benchmark:local` creates
  `.tmp/benchmark-reports/benchmark-local.jsonl` with recall-quality and
  graph-scale rows.
- AE2. Running `OPENMEMORY_SCALE_GRAPH_SIZE=1000 bun run test:scale:local`
  creates `.tmp/benchmark-reports/scale-local.jsonl` with a graph-scale row.
- AE3. The release workflow uploads `.tmp/benchmark-reports/*.jsonl` as
  `benchmark-reports`.

## Implementation Units

### U1. Benchmark Report Emission

- Files:
  - `apps/api/test/http.integration.test.ts`
- Approach:
  - Add an `OPENMEMORY_BENCHMARK_REPORT` opt-in helper.
  - Append one JSONL row for recall quality and one for graph scale when the
    relevant tests run.
  - Keep assertions unchanged.

### U2. Script and Workflow Wiring

- Files:
  - `package.json`
  - `.github/workflows/release-qualification.yml`
- Approach:
  - Set report paths in root benchmark scripts.
  - Upload `.tmp/benchmark-reports/*.jsonl` with `if: always()`.

### U3. Documentation

- Files:
  - `README.md`
  - `docs/release-qualification.md`
  - `docs/launch-readiness.md`
  - `docs/roadmap.md`
- Approach:
  - Document generated reports and artifact upload.
  - Keep the remaining production observation gap explicit.

## Verification Plan

- `bun run format`
- `bun run test:benchmark:local`
- `OPENMEMORY_SCALE_GRAPH_SIZE=220 bun run test:scale:local`
- Inspect generated `.tmp/benchmark-reports/*.jsonl`
- `bun run check`
- `bun run build`

## Scope Boundaries

- This does not run synthetic load against production.
- This does not add graph sharding.
- This does not change benchmark thresholds.
