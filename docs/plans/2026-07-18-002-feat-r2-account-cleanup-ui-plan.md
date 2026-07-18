# R2 Account Cleanup and Deletion UI Plan

artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code

## Direction

Close the next launch-safety gap by making destructive tenant/account deletion
clean up tenant-scoped R2 export objects in code, then expose the confirmed
account deletion path in the hosted dashboard.

## Settled Decisions

- **Cloudflare-native data lifecycle.** User-directed. Rejected alternative:
  relying only on external lifecycle/manual cleanup for tenant export objects.
  Reason: deletion should be best-effort complete across the Cloudflare-native
  stack when the binding exists.
- **Backend first.** User-directed. Rejected alternative: polishing only the
  companion UI. Reason: the backend is the workhorse and privacy/data lifecycle
  behavior is launch-critical.
- **No feature flags.** User-directed. Rejected alternative: adding conditional
  product flags around core deletion behavior. Reason: the codebase should stay
  clean and consistent.
- **Testing trophy emphasis.** User-directed. Rejected alternative: unit-only
  confidence. Reason: destructive multi-service behavior needs integration and
  browser coverage.

## Requirements

- R1. `DELETE /v1/tenant` must best-effort delete all R2 export objects under
  the resolved tenant's export prefix when `MEMORY_EXPORTS` is configured.
- R2. `DELETE /v1/account` must include the same R2 export cleanup after the
  authenticated email and tenant confirmation checks pass.
- R3. Deletion responses must expose export cleanup details without leaking
  object contents or unrelated tenant keys.
- R4. The client package must type the new deletion response shape.
- R5. Integration tests must prove export objects are removed for the deleted
  tenant and do not affect another tenant.
- R6. The hosted dashboard must provide a deliberate account deletion surface
  that requires both email and tenant id confirmation before calling the API.
- R7. Docs must describe the implemented R2 cleanup behavior and the remaining
  lifecycle/restore boundaries.

## Acceptance Evidence

- AE1. Local Wrangler integration creates R2 exports for two tenants, deletes
  one tenant, and verifies the deleted tenant's exports are gone while the other
  tenant's exports remain.
- AE2. Session-backed account deletion integration reports export cleanup in
  the response.
- AE3. Local browser E2E exercises the account settings/danger-zone state and
  refreshed screenshots show the dashboard states without layout overlap.
- AE4. `bun run check`, `bun run build`, local E2E, MCP SDK smoke, Docker
  integration, benchmark, and scale suites pass before PR.

## Implementation Notes

- Add a small helper around `R2Bucket.list({ prefix })` plus batch `delete` so
  cleanup handles pagination and reports `{ attempted, deleted, r2Configured }`.
- Keep cleanup best-effort: graph purge and D1 control-plane deletion should
  still complete if R2 cleanup fails, but the response should report the error
  signal safely.
- Use the existing shadcn-style settings/admin patterns for the dashboard
  surface. Avoid inventing a separate visual system.
