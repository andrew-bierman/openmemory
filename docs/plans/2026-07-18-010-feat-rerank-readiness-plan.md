---
title: "feat: Expose rerank readiness"
date: "2026-07-18"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# feat: Expose rerank readiness

## Goal Capsule

Expose the optional Workers AI recall reranker as an explicit readiness surface so operators can tell whether recall is running deterministically, AI reranking is enabled, or configuration is incomplete.

## Problem Frame

OpenMemory now has a shared recall path with optional Workers AI reranking. The behavior falls back safely, but there is no first-class readiness signal in the API or dashboard, which makes a production deployment harder to inspect and support.

## Requirements

- R1. The API readiness snapshot reports rerank configuration, Workers AI binding presence, selected model, timeout budget, and a clear status.
- R2. Misconfigured reranking, specifically a configured model without Workers AI, appears in readiness warnings.
- R3. The generated/shared client type includes the new readiness shape for downstream web and MCP consumers.
- R4. The operations dashboard displays rerank status in both the summary grid and detailed readiness cards.
- R5. Integration and model tests cover disabled, enabled, and misconfigured states.

## Key Technical Decisions

- KTD1. Model the reranker as `enabled`, `disabled`, or `misconfigured` rather than a generic boolean. This matches how operators reason about production readiness and avoids hiding the fallback state.
- KTD2. Keep the rerank snapshot inside the existing readiness endpoint. Readiness is already the operational aggregation point and the dashboard already consumes it.
- KTD3. Preserve deterministic fallback behavior when reranking is disabled or misconfigured. This change is observability and guardrail surface only, not a recall ranking behavior change.

## Implementation Units

### U1. API Readiness Snapshot

**Goal:** Add rerank metadata to the API readiness contract.

**Requirements:** R1, R2, KTD1, KTD2, KTD3

**Dependencies:** None

**Files:** `apps/api/src/readiness.ts`, `apps/api/test/http.integration.test.ts`

**Approach:** Derive rerank state from `OPENMEMORY_RERANK_MODEL`, `OPENMEMORY_RERANK_TIMEOUT_MS`, and the Workers AI binding. Include timeout parsing with the same defensive posture used elsewhere in readiness.

**Patterns to follow:** Existing `semanticIndex` and `warnings` readiness aggregation.

**Test scenarios:**
- Disabled path: no rerank model returns `configured: false`, `workersAiConfigured: false`, default timeout, and `status: disabled`.
- Misconfigured path: rerank model without Workers AI returns `status: misconfigured` and warning `rerank_model_requires_workers_ai`.
- Enabled path: rerank model with Workers AI returns `status: enabled` and includes the model.

**Verification:** API integration tests prove the readiness JSON shape and warning behavior.

### U2. Shared Client and Dashboard Model

**Goal:** Carry the readiness shape through the shared client and dashboard model.

**Requirements:** R3, R4

**Dependencies:** U1

**Files:** `packages/client/src/index.ts`, `apps/web/src/dashboard-model.ts`, `apps/web/src/dashboard-model.test.ts`

**Approach:** Add a typed `RerankReadiness` object and summarize it into dashboard labels: `AI rerank`, `Deterministic`, `Needs AI`, and `Unknown`.

**Patterns to follow:** Existing `ReadinessSnapshot` type and `getReadinessSummary` derived display model.

**Test scenarios:**
- Enabled readiness maps to `AI rerank`.
- Disabled readiness maps to `Deterministic`.
- Misconfigured readiness maps to `Needs AI`.
- Missing readiness maps to `Unknown`.

**Verification:** Dashboard model tests cover display labels independently from rendering.

### U3. Operations UI Rendering

**Goal:** Display rerank status in the operations dashboard.

**Requirements:** R4

**Dependencies:** U2

**Files:** `apps/web/src/routes/index.tsx`

**Approach:** Add a summary readiness card and a detailed operations card near the semantic index section. Use existing shadcn-style card primitives and lucide icons so it stays visually consistent.

**Patterns to follow:** Existing operations readiness grid, semantic index detail card, and Cloudflare bindings table.

**Test scenarios:**
- E2E operations screenshot shows rerank status without layout overlap.
- Loading or unavailable readiness still renders a stable fallback.

**Verification:** Local E2E screenshot coverage captures the operations state.

## Verification Contract

- Type checks pass for API, web, client, and tests.
- Focused API and dashboard model tests pass.
- Full local check suite passes.
- Local E2E screenshots include operations readiness with rerank details.

## Scope Boundaries

This plan does not change recall ranking behavior, add a new rerank model picker, or require Workers AI in local development. It only makes the current optional rerank path inspectable and safer to operate.

## Definition of Done

- Rerank readiness appears in API responses, client types, dashboard summary, and dashboard details.
- Tests cover all rerank readiness statuses.
- The branch is committed, pushed, opened as a PR, and validated by CI.
