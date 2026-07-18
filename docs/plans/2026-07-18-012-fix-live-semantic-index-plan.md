---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
created: 2026-07-18
---

# Fix Live Semantic Index Verification

## Goal Capsule

Make hosted production smoke prove that Workers AI embeddings and Vectorize semantic retrieval work end to end, while preserving the Durable Object graph as canonical state and keeping local fallback tests honest.

## Problem Frame

The current production build and deploy path is green, but the live smoke after PR #56 still returned only keyword and graph search reasons. The semantic write path remains best-effort and swallows provider errors, so `/v1/index/repair` can report a generic `needs_repair` state without explaining whether Vectorize upsert failed, is delayed, or cannot be queried.

Cloudflare Vectorize metadata filtering currently documents scalar metadata index types: `string`, `number`, and `boolean`. The upsert payload stores `tags` as a string array even though search filters only use `tenantId`, `status`, and `isLatest`. That unnecessary array metadata is a plausible hosted upsert failure and should be removed from the provider contract.

## Product Contract

- R1. Semantic index writes must use Cloudflare-compatible scalar metadata only.
- R2. Index repair must expose bounded provider diagnostics without leaking memory content or credentials.
- R3. Live E2E must wait for the semantic index to become current before requiring semantic recall, because Vectorize is eventually consistent.
- R4. Local tests must still pass without Workers AI or Vectorize.
- R5. Docs must reflect the production Vectorize metadata shape and live verification behavior.

## Key Technical Decisions

- KTD-1: Keep Vectorize as an auxiliary semantic candidate index.
  - Provenance: user-directed.
  - Rejected alternative: external graph/vector database.
  - Reason: the launch goal is Cloudflare-native, with Durable Objects holding canonical graph state.
- KTD-2: Remove non-filtered array metadata from Vectorize upserts.
  - Provenance: plan-derived from Cloudflare Vectorize scalar metadata index documentation.
  - Rejected alternative: retain `tags: string[]` in Vectorize metadata.
  - Reason: tags are not used by Vectorize filters and can be hydrated from the canonical graph.
- KTD-3: Add observable repair outcomes instead of throwing on normal writes.
  - Provenance: plan-derived from the live smoke failure.
  - Rejected alternative: make every memory write fail when Vectorize is unavailable.
  - Reason: graph writes remain canonical, but repair/live checks need provider error details.

## Implementation Units

### U1. Semantic Provider Result Contract

Files:
- `apps/api/src/semantic-index.ts`
- `apps/api/test/semantic-index.test.ts`

Work:
- Change `indexMemory` to return a small result object with `attempted`, `indexed`, `vectorId`, and bounded `error` fields while preserving no-throw behavior for normal graph writes.
- Store only scalar Vectorize metadata: `tenantId`, `memoryId`, `source`, `status`, and `isLatest`.
- Normalize `deleteTenantVectors` counting so unknown Vectorize return shapes do not produce `null`.

Test scenarios:
- Upsert payload omits array tags and keeps tenant/currentness metadata.
- Upsert failures return a sanitized error and do not throw.
- Missing bindings return a configured false/no-op result.
- Delete result shapes with and without `count` produce numeric totals.

### U2. Repair Diagnostics and Live Wait

Files:
- `apps/api/src/index.ts`
- `apps/api/test/http.integration.test.ts`
- `apps/api/test/live.e2e.test.ts`

Work:
- Have `/v1/index/repair` aggregate index results with `indexed`, `failed`, and bounded `errorSample`.
- Ensure the response never includes raw memory content, passwords, cookies, or tokens.
- Update live smoke to poll repair diagnostics until semantic status is `current` or until timeout before asserting semantic recall.
- Keep the assertion that search includes `reason: "semantic"` once the provider is current.

Test scenarios:
- Repair reports failed index attempts from a mocked Vectorize error.
- Repair reports indexed count when mocked providers succeed.
- Live E2E waits on repair status with bounded retry timing.

### U3. Documentation and Launch Readiness Record

Files:
- `docs/data-model.md`
- `docs/deployment.md`
- `docs/launch-readiness.md`
- `docs/plans/testing-strategy.md`

Work:
- Document the scalar Vectorize metadata contract.
- Document that tags/entities are canonical graph data and are not Vectorize metadata.
- Record that live remote semantic provider smoke is required before launch readiness can be claimed.

## Verification

- `bun --cwd apps/api vitest run test/semantic-index.test.ts test/http.integration.test.ts -t "semantic|index repair|Vectorize"`
- `bun run --cwd apps/api check-types`
- `bun run check`
- `bun run test:integration:local`
- `bun run build`
- Trigger live smoke after deployment and require API live E2E green.

## Scope Boundaries

- This pass does not redesign graph relationships, ranking, MCP tools, Better Auth, or the shadcn dashboard.
- This pass does not weaken semantic live assertions to fallback-only readiness.
- This pass does not introduce non-Cloudflare production storage.
