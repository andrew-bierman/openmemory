---
title: "feat: Add MCP vendor dogfood evidence gate"
date: "2026-07-19"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# feat: Add MCP vendor dogfood evidence gate

## Goal Capsule

- **Objective:** Make the remaining real-vendor MCP client dogfooding gap explicit, machine-validated, and visible in release qualification without blocking ordinary CI while evidence is still pending.
- **Authority hierarchy:** The user's launch-readiness goal is authoritative; preserve Cloudflare-native architecture and the existing MCP client profile smoke strategy.
- **Execution profile:** Standard production-readiness work with documentation and validation behavior.
- **Stop conditions:** Stop if the current docs already contain a stricter gate that this would duplicate, or if implementation would require live vendor credentials that are not available locally.
- **Tail ownership:** Normal LFG shipping applies: implementation, local verification, PR, and CI follow this plan.

---

## Product Contract

### Summary

OpenMemory already has CI smoke coverage for MCP protocol shape, official SDK behavior, generic OAuth callback behavior, and dashboard-managed PKCE client lifecycle. The remaining launch risk is real external-client dogfooding in MCP Inspector, Cursor, Claude, and ChatGPT surfaces. This work turns that risk into a structured evidence ledger and release gate so the project cannot accidentally present config-shape coverage as real vendor proof.

### Problem Frame

The current launch docs say manual vendor dogfooding remains recommended, but the status is prose-only. That makes it easy for launch readiness, release qualification, and compatibility docs to drift apart as PRs land. A machine-checked evidence artifact gives maintainers a single source of truth for which vendor clients are pending, blocked, or passed and what evidence is required before a broad hosted launch.

### Requirements

- R1. Add a versioned, repo-owned MCP vendor dogfooding evidence artifact for MCP Inspector, Cursor, Claude, and ChatGPT.
- R2. Validate the artifact shape, required client coverage, status transitions, and documentation references with a Bun TypeScript checker.
- R3. Keep normal CI green while vendor evidence is pending, but provide a strict command that fails until all required vendor surfaces pass with evidence.
- R4. Add a manual GitHub Actions workflow that can run the status check or strict launch gate on demand.
- R5. Update compatibility, launch-readiness, release-qualification, roadmap, and README docs so they point at the same evidence source and do not overclaim pending manual coverage.

### Scope Boundaries

- In scope: evidence schema, validation script, package scripts, manual workflow, and documentation alignment.
- Out of scope: creating OAuth apps inside third-party products, performing manual vendor UI tests without credentials/access, or changing the MCP server runtime.
- Deferred to Follow-Up Work: once manual tests are performed, update the evidence artifact with real run URLs/screenshots and run the strict gate before a broad hosted launch.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Separate CI-safe status from strict launch gate.** Use an `--allow-pending` mode in normal validation and a strict mode for release qualification so daily development remains unblocked while the launch checklist still has an executable blocker.
- KTD2. **Evidence lives in config, not docs.** Store canonical status in `config/mcp-vendor-dogfood.json`; docs reference it and the checker prevents docs from forgetting required vendors.
- KTD3. **Manual workflow, not automatic vendor tests.** External vendor products require authenticated UI or provider configuration that cannot be safely assumed in CI, so GitHub Actions should expose a manually dispatched gate rather than pretending this can be fully automated today.

### Assumptions

- The hosted MCP URL remains `https://openmemory-api.abbierman101.workers.dev/mcp`.
- Pending evidence is expected at plan time; strict mode should fail until maintainers update the ledger with real proof.
- The existing `scripts/mcp-client-profile-check.ts` style is the closest local pattern for a validation script.

---

## Implementation Units

### U1. Add Vendor Dogfood Ledger

- **Goal:** Create a structured evidence artifact for required external MCP client dogfooding.
- **Requirements:** R1, KTD2.
- **Dependencies:** None.
- **Files:** `config/mcp-vendor-dogfood.json`.
- **Approach:** Model each vendor with a stable kebab-case id, display name, required flag, status, transport, expected OAuth mode, checklist items, notes, and nullable evidence fields. Start every real vendor as `pending` unless the repo already has actual vendor evidence.
- **Patterns to follow:** `config/mcp-client-profiles.json` for compact JSON shape and stable ids.
- **Test scenarios:** Covered by U2 checker scenarios.
- **Verification:** The artifact is readable JSON and names all required external clients.

### U2. Add Checker and Manual Workflow

- **Goal:** Validate the dogfood ledger and expose both CI-safe status and strict launch gate commands.
- **Requirements:** R2, R3, R4, KTD1, KTD3.
- **Dependencies:** U1.
- **Files:** `scripts/mcp-vendor-dogfood-check.ts`, `package.json`, `.github/workflows/mcp-vendor-dogfood.yml`.
- **Approach:** Implement a no-dependency TypeScript script that validates schema, required vendors, docs references, status-specific evidence, and strict-vs-allow-pending exit behavior. Add `mcp:vendor-dogfood:status` for CI-safe validation and `mcp:vendor-dogfood:check` for strict launch qualification. Add a workflow_dispatch workflow with a strict boolean input.
- **Execution note:** Characterize both modes locally: status mode should pass with pending vendors; strict mode should fail until evidence is present.
- **Patterns to follow:** `scripts/mcp-client-profile-check.ts`, root `check` script composition, existing GitHub workflow setup for Bun.
- **Test scenarios:** Status mode accepts pending required vendors and prints a summary; strict mode rejects pending required vendors; invalid or missing required vendor ids throw clear errors; docs missing a vendor name fail validation.
- **Verification:** `bun run mcp:vendor-dogfood:status` exits zero; `bun run mcp:vendor-dogfood:check` exits non-zero while evidence is pending; `bun run check` includes status validation and remains green.

### U3. Align Launch Documentation

- **Goal:** Make launch docs point to the same canonical evidence gate without overstating real-vendor coverage.
- **Requirements:** R5.
- **Dependencies:** U1, U2.
- **Files:** `README.md`, `docs/mcp-compatibility.md`, `docs/launch-readiness.md`, `docs/release-qualification.md`, `docs/roadmap.md`.
- **Approach:** Update MCP compatibility docs with the ledger and commands, mark real vendor dogfooding as pending/manual, update launch readiness with a concrete unchecked item, and add release qualification instructions to run strict mode after updating evidence.
- **Patterns to follow:** Existing launch evidence and MCP profile documentation style.
- **Test scenarios:** The checker validates docs reference every required vendor and the canonical config path.
- **Verification:** Docs accurately distinguish CI-smoked request profiles from real external-client dogfooding and no checklist item is marked complete without evidence.

---

## Verification Contract

| Gate | Applies To | Done Signal |
| --- | --- | --- |
| `bun run mcp:vendor-dogfood:status` | U1, U2, U3 | Passes with pending vendor evidence and prints a required-client summary. |
| `bun run mcp:vendor-dogfood:check` | U2 | Fails while required real-vendor evidence is pending. |
| `bun run check` | U1, U2, U3 | Passes with the CI-safe status checker included. |
| `bun run build` | U2 package-script safety | Passes without changing build artifacts unexpectedly. |

---

## Definition of Done

- The repo has one canonical MCP vendor dogfood ledger for Inspector, Cursor, Claude, and ChatGPT.
- Normal CI validates the ledger shape and docs references without requiring unavailable third-party credentials.
- Strict release qualification fails until all required real-vendor dogfood entries include evidence.
- Docs and launch readiness distinguish real vendor dogfooding from config-shape smoke coverage.
- No abandoned experimental files remain in the diff.
