---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
created: 2026-07-18
title: Graph Import Preview
---

# Graph Import Preview

## Goal Capsule

OpenMemory import supports destructive `replace` and additive `merge`, but launch operators still need a safe preflight surface that reports what an import would do before any tenant graph mutation. Add a validated `/v1/imports/preview` endpoint, typed client support, docs, and integration coverage so tenants can inspect conflicts, duplicate IDs, dangling edges, and expected graph impact before restore.

## Product Contract

### Problem Frame

Graph restore is one of the riskiest backend workflows because it can overwrite or merge tenant memory relationships. Operators should not have to run a write request to discover whether an export is valid, whether merge will skip duplicates, or whether replace will delete existing graph data.

### Requirements

- R1. `POST /v1/imports/preview` must require the same tenant confirmation and graph export validation as `POST /v1/imports`.
- R2. Preview must support `mode: "replace"` and `mode: "merge"` without mutating memories, edges, tags, entities, ingestion jobs, Vectorize, or R2.
- R3. Replace preview must report existing tenant graph counts that would be deleted plus incoming memory/edge counts that would be imported.
- R4. Merge preview must report incoming memories that would be imported versus skipped by existing memory ID, incoming edge count, and dangling edge validation against the union of existing and incoming memory IDs.
- R5. Preview responses must include bounded conflict detail useful for UI/operator decisions without returning full memory content.
- R6. Client and docs must expose the preview flow alongside import so downstream MCP/UI callers can preflight safely.
- R7. Integration coverage must prove preview is read-only and validates tenant mismatch, invalid exports, dangling edges, replace impact, and merge duplicate behavior.

### Acceptance Examples

- AE1. Given tenant A has two memories and one edge, when a replace preview is posted with a valid one-memory export, then the response reports two memories and one edge would be deleted and one memory would be imported; tenant A's graph remains unchanged afterward.
- AE2. Given tenant A already has `mem_a`, when a merge preview includes `mem_a` and `mem_new`, then the response reports one skipped existing ID, one new memory, and imported edge count without changing the graph.
- AE3. Given a merge preview contains an edge to a memory absent from both existing tenant graph and incoming export, then the API returns `400 graph_import_failed` with `graph_export_contains_dangling_edges`.
- AE4. Given `confirmTenantId` does not match the resolved tenant, preview returns the existing `409 tenant_confirmation_mismatch` shape.

## Key Technical Decisions

- KTD1. **Add a Durable Object preview method rather than duplicating SQL in the Worker route.**
  - Rationale: `MemoryGraph` already owns graph counts, existing IDs, and edge validation; keeping preview there avoids API/DO drift.
  - Rejected alternative: compute preview in `apps/api/src/index.ts`.

- KTD2. **Keep preview detail bounded to IDs and counts.**
  - Rationale: operators need conflict shape, not full memory content; limiting lists prevents accidental content disclosure and large responses.
  - Rejected alternative: return full duplicate/incoming memory records.

- KTD3. **Reuse import validation semantics.**
  - Rationale: a green preview should mean the later import is structurally valid for the same tenant state, modulo races.
  - Rejected alternative: make preview permissive and leave final validation to import.

## Implementation Units

### U1. Graph Preview Core

- Files:
  - `apps/api/src/memory-graph.ts`
- Approach:
  - Add an import mode type local to the graph module.
  - Add `previewGraphImport(input, mode)` that parses `GraphExportPayloadSchema`, reads current memory IDs and stats/counts, validates dangling edges using the same rules as replace/merge, and returns a serializable preview object.
  - Include `limitedExistingMemoryIds`, `limitedNewMemoryIds`, and `limitedDanglingEdges` with a fixed cap.
- Tests:
  - Covered through `apps/api/test/http.integration.test.ts`.

### U2. API Route

- Files:
  - `apps/api/src/index.ts`
- Approach:
  - Add `POST /v1/imports/preview` before `POST /v1/imports`.
  - Reuse `graphImportBody`, tenant resolution, tenant confirmation, `GraphExportPayloadSchema.safeParse`, and `graph_import_failed` error handling.
  - Return `200` for successful previews.
- Tests:
  - Tenant mismatch returns `409`.
  - Invalid export returns `400 invalid_graph_export`.
  - Dangling merge returns `400 graph_import_failed`.
  - Replace and merge previews return expected counts and do not mutate tenant graph.

### U3. Typed Client

- Files:
  - `packages/client/src/index.ts`
- Approach:
  - Add `GraphImportPreviewResult`.
  - Add `previewGraphImport({ confirmTenantId, export, mode? })` defaulting to `replace`.
  - Extend the Eden route shape for `imports.preview.post`.
- Tests:
  - Existing client type tests are covered by `bun --cwd packages/client test` and root typecheck.

### U4. Documentation

- Files:
  - `README.md`
  - `docs/data-model.md`
  - `docs/operations.md`
  - `docs/roadmap.md`
- Approach:
  - Document the preview endpoint and operator workflow.
  - Move roadmap wording from “no field-level diff conflict resolution” to the narrower remaining gap after preview ships.

## Verification Plan

- `bun run --cwd apps/api check-types`
- `bun run --cwd apps/api test:integration`
- `bun --cwd packages/client test`
- `bun run check`
- `bun run build`
- Browser screenshot refresh if web surfaces changed; otherwise report existing launch screenshot bundle.

## Scope Boundaries

- This does not implement field-level conflict resolution or automatic merge policy for changed memories with the same ID.
- This does not add a dashboard import wizard; the backend/client preflight surface comes first.
- This does not run a production mutation benchmark.
