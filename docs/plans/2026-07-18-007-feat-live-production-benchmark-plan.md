---
title: Live Production Benchmark - Plan
type: feat
date: 2026-07-18
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Live Production Benchmark - Plan

## Goal Capsule

- **Objective:** Add a production-safe live benchmark gate that creates a bounded synthetic graph in a throwaway hosted account, measures hosted graph recall latency, emits JSONL evidence, and cleans up the account.
- **Authority:** The launch-readiness goal and `docs/roadmap.md` gap that graph performance still needs recurring high-volume production observations before a hosted SaaS launch.
- **Execution profile:** Standard launch-hardening change across live tests, scripts, workflow, and docs.
- **Stop conditions:** Stop if the benchmark cannot clean up through the account deletion API or if it would require production secrets beyond the existing deployed Worker URL.

---

## Product Contract

OpenMemory has local graph-scale benchmarks and hourly live smoke, but those gates do not produce recurring hosted graph-performance evidence. A launch candidate needs a bounded production observation path that exercises the deployed Worker, Durable Object graph storage, import path, embedding/indexing path, graph stats, and recall under a larger synthetic tenant.

### Requirements

- R1. Add an opt-in live benchmark test that only runs when explicitly enabled and targets `OPENMEMORY_LIVE_BASE_URL`.
- R2. The benchmark must create a throwaway hosted account, import a bounded synthetic graph, measure recall latency, assert a conservative threshold, and delete the account in `finally`.
- R3. The graph size must default to a safe production size and clamp caller-provided sizes so scheduled runs cannot accidentally create unbounded hosted state.
- R4. The benchmark must write JSONL evidence when `OPENMEMORY_BENCHMARK_REPORT` is set, including commit, graph size, edge count, result count, elapsed latency, and threshold.
- R5. Add a GitHub Actions workflow that can run manually and on a slower recurring cadence, then upload the benchmark JSONL artifact.
- R6. Docs must explain how to run the live benchmark and update the roadmap baseline/gap honestly.

### Acceptance Examples

- AE1. With `OPENMEMORY_LIVE_BENCHMARK=true`, the live benchmark imports a generated graph, recalls from it, writes a report row, and passes under the latency threshold.
- AE2. Without `OPENMEMORY_LIVE_BENCHMARK=true`, the benchmark file reports a skipped placeholder rather than touching production.
- AE3. With `OPENMEMORY_LIVE_GRAPH_SIZE=10000`, the test clamps to the documented maximum.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Use `/v1/imports` with a generated graph export instead of many individual create requests. This exercises the restore/index path while avoiding request-rate noise.
- KTD2. Keep the workflow separate from hourly `Live Smoke`. The benchmark is heavier and should not make the fast alpha alert path noisy.
- KTD3. Reuse the account deletion API for cleanup. It already purges graph data, Vectorize ids, R2 exports, and control-plane rows.
- KTD4. Use JSONL reports under `.tmp/benchmark-reports/` to match local benchmark evidence and release qualification artifacts.

### Scope Boundaries

- This plan does not run destructive operations against real user tenants.
- This plan does not perform unbounded load testing or concurrent stress testing.
- This plan does not change production thresholds for local benchmark gates.

---

## Implementation Units

### U1. Live Benchmark Test

- **Goal:** Add a gated hosted graph benchmark in `apps/api/test/live.e2e.test.ts`.
- **Requirements:** R1, R2, R3, R4, AE1, AE2, AE3.
- **Files:** `apps/api/test/live.e2e.test.ts`, `apps/api/package.json`, `package.json`.
- **Approach:** Add `OPENMEMORY_LIVE_BENCHMARK` gating, bounded graph-size parsing, generated memory/edge export payload, import timing, recall timing, graph-stat assertions, benchmark JSONL append helper, and account cleanup in `finally`.
- **Patterns to follow:** Existing live account/session flow, existing local benchmark report helper, and existing graph import payload shape.
- **Test scenarios:** Disabled benchmark skips production mutation; enabled benchmark imports default graph size; oversized graph size clamps to maximum; report path writes one JSONL row.
- **Verification:** Targeted live benchmark can be invoked explicitly and local type/check gates pass.

### U2. Workflow and Documentation

- **Goal:** Add a recurring/manual GitHub Actions gate and update launch docs.
- **Requirements:** R5, R6.
- **Files:** `.github/workflows/live-benchmark.yml`, `README.md`, `docs/release-qualification.md`, `docs/roadmap.md`.
- **Approach:** Add a slower scheduled workflow with `base_url` and `graph_size` inputs, set `OPENMEMORY_BENCHMARK_REPORT`, upload benchmark reports, and document the command/workflow as production-resource dependent evidence.
- **Patterns to follow:** `.github/workflows/live-smoke.yml`, `.github/workflows/release-qualification.yml`, and benchmark report docs.
- **Test scenarios:** Workflow YAML is syntactically consistent with existing Actions patterns; docs point to the new command and artifact path.
- **Verification:** Formatting, type-checking, and full repo checks pass; the manual workflow can be dispatched after merge.

---

## Verification Contract

| Gate | Proves | Units |
|---|---|---|
| `bun run format` | Biome accepts workflow/docs/test formatting. | U1, U2 |
| `bun run check-types` | Live benchmark test types compile. | U1 |
| `bun run check` | Existing local integration and all package tests remain green. | U1, U2 |
| `bun run build` | Production Worker/web build stays deployable. | U2 |
| Manual `Live Production Benchmark` workflow | Hosted graph benchmark passes and uploads report evidence. | U1, U2 |

---

## Definition of Done

- The live benchmark is opt-in, bounded, report-producing, and account-cleaning.
- GitHub Actions exposes a recurring/manual live production benchmark workflow.
- README, release qualification, and roadmap docs describe the new evidence path and remaining limitations.
- The branch is formatted, locally verified, committed with gitmoji, merged after green CI, and followed by a successful manual live benchmark run.
