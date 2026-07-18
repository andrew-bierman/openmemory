---
title: "feat: Add MCP OAuth callback verifier"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
slug: feat-mcp-oauth-callback-verifier
---

# feat: Add MCP OAuth callback verifier

## Direction

Close the remaining MCP production-flow gap by making OAuth callback behavior
repeatably testable with a real browser and a client-owned callback listener,
then document the evidence path for external MCP client dogfooding.

## Settled Decisions

- Decision: Keep OpenMemory Cloudflare-native.
  - Provenance: user-directed.
  - Rejected alternative: moving OAuth, MCP, graph, or RAG runtime off
    Cloudflare.
  - Reason: the product thesis is an open-source Cloudflare-native memory stack.
- Decision: Use Better Auth as the OAuth/OIDC provider.
  - Provenance: user-directed.
  - Rejected alternative: custom OAuth provider implementation.
  - Reason: Better Auth already owns sessions, consent, discovery, and token
    issuance.
- Decision: Keep MCP in the monolithic Worker for this launch pass.
  - Provenance: user-approved.
  - Rejected alternative: split into a dedicated MCP Worker immediately.
  - Reason: current MCP state does not require separate scaling or durable
    session isolation.
- Decision: Preserve Bun, TypeScript, Turborepo, Drizzle, Elysia/Eden,
  TanStack, shadcn-style UI, Vitest, and Playwright.
  - Provenance: user-directed.
  - Rejected alternative: replacing the current repo stack.
  - Reason: these are the established project conventions and the user's stated
    preferences.
- Decision: Avoid launch flags for required production behavior.
  - Provenance: user-directed.
  - Rejected alternative: hiding unfinished launch behavior behind feature
    switches.
  - Reason: the user asked for clean, consistent code rather than flag-driven
    partial paths.

Standing report-conflicts line: if a settled decision blocks correctness or
launch safety, stop and report the conflict instead of silently working around
it.

## Requirements

- R1. Add a Playwright-backed MCP OAuth callback verifier that registers an
  OAuth client, signs in or signs up through the hosted/browser auth flow,
  consents to MCP scopes, follows the authorization redirect to a local
  callback listener, captures the authorization code and state, exchanges the
  code for a bearer token, and calls `/mcp`.
- R2. The verifier must support local Worker/browser runs and the deployed live
  smoke environment without relying on hardcoded default ports.
- R3. The verifier must assert callback state, PKCE exchange, bearer token
  issuance, MCP `initialize`, `tools/list`, `remember`, `recall`, and cleanup.
- R4. The verifier must not log secrets, bearer tokens, passwords, or
  authorization codes.
- R5. CI/live smoke must run the verifier as part of hosted UI E2E so OAuth
  callback regressions are caught before launch.
- R6. Docs must distinguish verified callback-harness behavior from remaining
  manual vendor-surface dogfooding in Cursor, Claude, ChatGPT, and MCP
  Inspector.
- R7. Tests must cover helper logic where practical and keep the existing
  testing trophy shape: focused helpers, heavy integration/browser coverage for
  runtime boundaries.

## Acceptance Evidence

- AE1. `bun run test:e2e:local` passes and exercises the callback verifier
  against randomized local callback ports.
- AE2. `bun run test:e2e:ui` passes when live credentials/deployment are
  available and exercises the same callback verifier against production.
- AE3. `bun run test:mcp:sdk`, `bun run check`, and `bun run build` pass.
- AE4. Launch docs and MCP compatibility docs describe the new callback
  verifier and preserve only the genuinely manual external-client gap.
- AE5. Screenshots under `.tmp/screenshots/launch-readiness/` are refreshed for
  the dashboard states touched by this pass.

## Implementation Units

### U1: Shared Playwright OAuth Callback Harness

- Files: `apps/api/e2e/*`, `apps/web/e2e/*` or a shared test helper under
  `apps/api/e2e`.
- Approach: Build a tiny local HTTP callback listener using Node `http`, choose
  port `0`, register that exact callback URL, drive the browser through
  authorize/consent, wait for the callback request, exchange the code through
  the token endpoint, and return the access token without printing it.
- Verification: helper-level assertions are covered by the browser E2E that
  proves real redirect behavior.

### U2: Local and Live Browser Coverage

- Files: `apps/api/e2e/live-ui.spec.ts`, `apps/web/e2e/dashboard.spec.ts`,
  Playwright configs if needed.
- Approach: Use the helper in the live UI smoke and add a local dashboard
  callback verifier that works with local tenant/session setup. Keep test ports
  explicit or randomized to avoid other agents.
- Verification: local and live Playwright suites pass.

### U3: Docs and Launch Evidence

- Files: `docs/mcp-compatibility.md`, `docs/launch-readiness.md`,
  `docs/roadmap.md`, `README.md`.
- Approach: Update language from generic config-shape smoke to callback-harness
  evidence where true, while leaving manual vendor UI dogfooding as the
  remaining gap.
- Verification: docs are consistent with implemented tests and no longer
  overclaim real vendor UI certification.

## Non-Goals

- Do not create GitHub or Google OAuth provider applications.
- Do not split the MCP endpoint into a separate Worker in this pass.
- Do not automate vendor-owned Cursor, Claude, ChatGPT, or MCP Inspector UI
  flows that are unavailable from this local environment.
- Do not weaken existing OAuth, MCP, or live smoke assertions.
