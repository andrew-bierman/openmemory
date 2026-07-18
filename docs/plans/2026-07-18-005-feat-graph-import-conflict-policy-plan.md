---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
created: 2026-07-18
title: Graph Import Conflict Policy
---

# Graph Import Conflict Policy

## Goal Capsule

OpenMemory graph merge currently skips every incoming memory whose ID already
exists, even when the export contains a materially different record. Add a
safe field-level conflict surface and an explicit overwrite policy so restore
operators can preview changed duplicate memories and intentionally resolve them
without using destructive whole-tenant replace.

## Product Contract

### Requirements

- R1. Existing import defaults must stay backward compatible: merge continues
  to skip duplicate memory IDs unless the caller opts into overwrite.
- R2. `POST /v1/imports/preview` must distinguish unchanged duplicate IDs from
  changed duplicate IDs and expose bounded field-level conflict detail without
  returning memory content.
- R3. `POST /v1/imports` with `mode: "merge"` and
  `conflictPolicy: "overwrite"` must replace changed duplicate memory records,
  refresh tags/entities, upsert export edges, and re-index overwritten active
  latest memories.
- R4. Replace mode must remain destructive and ignore merge conflict policy.
- R5. Client types and docs must describe the conflict policy and preview
  fields.
- R6. Integration tests must prove default skip, preview field conflicts, and
  explicit overwrite behavior.

### Acceptance Examples

- AE1. Merge preview for an export containing an existing memory with identical
  fields reports the ID under `unchangedMemoryIds`.
- AE2. Merge preview for an export containing an existing memory with changed
  content/tags/metadata reports the ID under `changedMemoryIds` and lists those
  field names in `fieldConflicts`.
- AE3. Merge import without `conflictPolicy` skips a changed duplicate and
  leaves the existing memory unchanged.
- AE4. Merge import with `conflictPolicy: "overwrite"` updates the duplicate
  memory, refreshes its tags/entities, returns an overwrite count, and indexes
  the overwritten active latest memory.

## Implementation Units

### U1. Graph Diff and Overwrite Core

- Files:
  - `apps/api/src/memory-graph.ts`
- Approach:
  - Add a merge conflict policy type: `skip | overwrite`.
  - Add helpers to compare import-relevant memory fields and return changed
    field names.
  - Extend preview to report duplicate, unchanged, changed, and field-conflict
    details with the existing bounded list limit.
  - Extend merge to upsert duplicate memories only when policy is `overwrite`.

### U2. API and Client Types

- Files:
  - `apps/api/src/index.ts`
  - `packages/client/src/index.ts`
- Approach:
  - Add optional `conflictPolicy` to import/preview bodies and client methods.
  - Default to `skip`.
  - Index both newly imported and overwritten active latest memories.

### U3. Tests and Docs

- Files:
  - `apps/api/test/http.integration.test.ts`
  - `README.md`
  - `docs/data-model.md`
  - `docs/operations.md`
  - `docs/roadmap.md`
- Approach:
  - Extend the existing graph export/import integration scenario.
  - Document preview-first restore and explicit overwrite semantics.
  - Remove the roadmap gap that says field-level diff conflict resolution is
    not implemented, replacing it with the remaining limitation: no automatic
    semantic merge.

## Verification Plan

- `bun run format`
- `bun run --cwd apps/api check-types`
- `bun run --cwd apps/api test:integration`
- `bun --cwd packages/client test`
- `bun run check`
- `bun run build`

## Scope Boundaries

- This does not implement automatic semantic merge of two changed memory
  records.
- This does not show import conflicts in the web UI yet.
- This does not change replace-mode behavior.
