---
title: "feat: Add live provider smoke"
date: "2026-07-18"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# feat: Add live provider smoke

## Goal Capsule

Make live production smoke prove the remote Workers AI and Vectorize semantic provider path, not only the deterministic graph/keyword fallback path.

## Problem Frame

OpenMemory has strong local integration tests, but local Wrangler cannot fully emulate Workers AI and Vectorize. The release docs still call out remote provider smoke as a coverage gap. A launch candidate needs an opt-in hosted check that indexes real test memories, verifies semantic index diagnostics, and observes semantic recall from the deployed Worker.

## Requirements

- R1. Live production E2E must repair/check the semantic index after creating hosted test data.
- R2. Live production E2E must assert Workers AI and Vectorize are configured on the deployed Worker.
- R3. Live production E2E must prove semantic recall can return at least one result with `reason: "semantic"`.
- R4. Cleanup must continue through existing account deletion and leave no new production test row pattern.
- R5. Release/testing docs must describe the remote provider smoke coverage and remove stale wording that says it is missing.

## Key Technical Decisions

- KTD1. Extend `apps/api/test/live.e2e.test.ts` instead of creating a new workflow. The existing `Live Smoke` workflow already has account lifecycle cleanup, production gating, and hosted API/UI coverage.
- KTD2. Use `/v1/index/repair` before asserting semantic recall. This removes eventual-index timing from the test and exercises the operator repair path at the same time.
- KTD3. Assert semantic contribution as “contains at least one semantic result,” not “semantic result is first.” Ranking can legitimately change as deterministic and optional AI rerank policies evolve.

## Implementation Units

### U1. Live Provider Assertions

**Goal:** Extend hosted API smoke to prove semantic provider readiness and recall contribution.

**Requirements:** R1, R2, R3, R4, KTD1, KTD2, KTD3

**Files:** `apps/api/test/live.e2e.test.ts`

**Approach:** After source ingestion and graph stats, call `/v1/index/repair`, assert configured provider fields, then run a query targeted at the seeded source text and require a semantic result.

**Test scenarios:**
- Hosted repair reports `vectorizeConfigured: true`, expected vectors, and a configured semantic index.
- Readiness reports Workers AI and Vectorize configured.
- Semantic search over hosted source text includes at least one `reason: "semantic"` result.

**Verification:** `OPENMEMORY_LIVE_E2E=true bun --cwd apps/api vitest run test/live.e2e.test.ts` passes through the `Live Smoke` workflow.

### U2. Documentation Alignment

**Goal:** Keep release docs honest about the new provider smoke.

**Requirements:** R5

**Files:** `docs/plans/testing-strategy.md`, `docs/release-qualification.md`, `docs/launch-readiness.md`

**Approach:** Update testing and launch-readiness language to state that live smoke covers remote Workers AI/Vectorize semantic indexing and recall.

**Test scenarios:** Documentation-only; no runtime test required beyond markdown being included in normal repo checks.

**Verification:** A release operator can identify where remote provider evidence comes from and no longer sees it listed as missing.

## Verification Contract

- Focused API typecheck passes.
- Focused live test type surface passes in normal skipped mode.
- Full repo check passes.
- PR CI passes.
- Fresh `Live Smoke` workflow passes after merge.

## Scope Boundaries

This does not tune embedding models, change reranking, add a new provider workflow, or make live smoke mandatory for PR CI. It strengthens the existing opt-in production gate.

## Definition of Done

- Live production smoke proves remote semantic provider readiness and semantic recall contribution.
- Docs reflect that remote provider smoke is now covered.
- CI and live smoke are green after merge.
