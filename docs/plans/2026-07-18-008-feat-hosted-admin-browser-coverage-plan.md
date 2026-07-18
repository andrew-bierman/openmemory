---
title: Hosted Admin Browser Coverage - Plan
type: feat
date: 2026-07-18
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Hosted Admin Browser Coverage - Plan

## Goal Capsule

- **Objective:** Expand hosted Playwright smoke coverage to exercise production Better Auth admin flows: profile rename, workspace rename, member invite/remove, OAuth connection visibility/revocation, and confirmed account deletion.
- **Authority:** The launch-readiness goal and `docs/roadmap.md` next implementation track calling for hosted authenticated profile/team flows and MCP connection revocation browser coverage.
- **Execution profile:** Lightweight launch-hardening test/docs slice with no production behavior changes.
- **Stop conditions:** Stop if the hosted UI cannot seed and clean up test accounts through existing public APIs without leaving production D1 rows.

---

## Product Contract

The backend already supports session-backed account management and OAuth grant revocation, and local browser tests cover local admin disabled states. The gap is production feedback from the hosted browser surface for authenticated profile/team/OAuth workflows.

### Requirements

- R1. Hosted browser E2E must sign up a production test account and navigate the dashboard Admin view.
- R2. The test must update the user display name through the UI and verify the updated profile appears.
- R3. The test must rename the hosted workspace through the UI and verify the updated workspace appears.
- R4. The test must invite a workspace member, verify the pending member row, remove that member through the UI, and verify removal.
- R5. The test must seed an OAuth client connection through the deployed auth API, verify it appears in the Admin MCP client access panel, revoke it through the UI, and verify removal.
- R6. The test must delete the hosted account through the Admin danger zone and verify the delete response succeeds.
- R7. Docs and roadmap must describe that hosted browser coverage now includes profile/team/OAuth admin flows.

### Acceptance Examples

- AE1. Given a fresh hosted signup, when the user saves a display name in Admin, then the profile card shows the new name.
- AE2. Given a hosted workspace, when the user saves a workspace name and invites a member, then both the workspace name and invited member row are visible.
- AE3. Given a seeded OAuth connection, when the user opens Admin and clicks Revoke, then the connection no longer appears.
- AE4. Given the account confirmation fields match, when the user deletes the account, then the API returns success and production cleanup leaves no live UI test rows.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Extend `apps/api/e2e/live-ui.spec.ts` instead of adding a second hosted UI spec. This keeps production browser smoke as one account lifecycle with one cleanup path.
- KTD2. Seed OAuth client registration through `page.request` after signup. The browser UI does not yet create first-party OAuth clients, but it can list and revoke grants.
- KTD3. Continue deleting the account at the end of the browser flow. Account deletion is the authoritative cleanup because it purges graph, OAuth, workspace, and user rows.

### Scope Boundaries

- This plan does not add new admin UI controls.
- This plan does not validate real external MCP clients; it seeds a first-party OAuth grant shape through the deployed API.
- This plan does not change Better Auth provider configuration or social OAuth secrets.

---

## Implementation Units

### U1. Hosted Admin Browser Flow

- **Goal:** Extend live browser E2E to cover Admin account/profile/workspace/member/OAuth flows.
- **Requirements:** R1, R2, R3, R4, R5, R6, AE1, AE2, AE3, AE4.
- **Files:** `apps/api/e2e/live-ui.spec.ts`.
- **Approach:** After signup and recall smoke, navigate to Admin, update profile/workspace, invite/remove a unique teammate, register an OAuth client through `page.request`, refresh Admin data, revoke the connection through the UI, then delete the account through the Admin danger-zone form.
- **Patterns to follow:** Existing live UI signup/memory/recall flow and existing API integration assertions for workspace/member/OAuth behavior.
- **Test scenarios:** Profile rename persists in the card; workspace rename persists in the card; invited member appears as admin/invited and disappears after Remove; OAuth connection appears with scopes and disappears after Revoke; account deletion succeeds.
- **Verification:** `OPENMEMORY_LIVE_E2E=true bun run test:e2e:ui` passes against production and manual D1 cleanup check returns zero live UI test users.

### U2. Docs Alignment

- **Goal:** Update launch docs and roadmap to state the hosted browser smoke covers Admin flows.
- **Requirements:** R7.
- **Files:** `README.md`, `docs/release-qualification.md`, `docs/roadmap.md`.
- **Approach:** Replace stale wording that says these browser flows remain untested with language that distinguishes covered hosted smoke from broader subjective navigation/product feedback.
- **Patterns to follow:** Existing testing and roadmap language.
- **Test scenarios:** Documentation states hosted admin coverage without implying real external MCP client dogfooding is complete.
- **Verification:** A roadmap reader can identify remaining launch gaps without seeing hosted profile/team browser coverage listed as missing.

---

## Verification Contract

| Gate | Proves | Units |
|---|---|---|
| `bun run format` | Spec/docs formatting is clean. | U1, U2 |
| `bun run check-types` | Playwright spec and shared package types compile. | U1 |
| `OPENMEMORY_LIVE_E2E=true bun run test:e2e:ui` | Hosted dashboard Admin browser flow passes in production. | U1 |
| `bun run check` | Existing local suite remains green. | U1, U2 |
| `bun run build` | Production bundle remains deployable. | U2 |

---

## Definition of Done

- Hosted UI smoke covers profile rename, workspace rename, member invite/remove, OAuth connection revoke, memory smoke, readiness, and account deletion.
- Docs and roadmap reflect the new hosted admin browser coverage and preserve external MCP dogfooding as a remaining gap.
- Production D1 has no leftover `ui-e2e-*` test users after the live run.
- The branch is committed with gitmoji, pushed, merged after green CI, and followed by successful main CI/live smoke.
