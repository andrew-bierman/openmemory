# Local validation and tenant review — 2026-10-17

Source candidate: `c85ed66f9b35588506e2e2550ee3705c5e4b4201`.
Implementation commits: `f8f697f` (delayed ingestion guard), `988042d` (current OAuth grant enforcement, lookup index, tenant tests).
Branch: `codex/tenant-validation-20261017`.

This pass strengthens local confidence; it does not certify broad hosted launch. No production mutation, credential grant, deployment, push, merge, tag, or publication was performed. The original checkout remained clean and unchanged.

## Architecture and tenancy

The runtime is Cloudflare-native: Workers serves API/MCP and static UI assets; named SQLite Durable Objects store graphs; D1 stores Better Auth and account/control-plane data; Workers AI and Vectorize supply semantic retrieval; R2 stores exports; Queues and Workflows perform ingestion/extraction, with dead-letter queues; Analytics Engine and cron support monitoring. Both Wrangler configurations declare these bindings and code consumes them. This audit did not independently verify deployed binding parity.

React/TanStack, Elysia, Drizzle, Better Auth, the MCP SDK and Cloudflare Agents SDK are application libraries, not additional required hosted databases or AI providers. Optional external integrations are GitHub/Google social login and alert webhook/email/PagerDuty destinations. No architectural rewrite is warranted by this review.

Memory tenancy is per authenticated **user/account**, not shared workspace. `auth.ts` derives the tenant from session user ID and selects `MEMORY_GRAPHS.idFromName(tenantId)`. Production MCP derives identity from a verified token; request-supplied tenant headers are development-only. Workspace membership/invitations currently manage metadata and do not establish shared team-memory authorization.

Reviewed boundaries:

- Memory CRUD/search routes operate on the authenticated user's graph. Two real cookie users now test foreign GET/PATCH/DELETE returning 404, empty foreign search/export, preservation of the owner's memory, and attempts to spoof the tenant header.
- Vectorize searches filter tenant/status/latest metadata; candidate IDs are hydrated only inside the caller's graph. Reranking accepts only existing candidates. Provider contract tests use doubles; no live semantic quality claim follows.
- R2 exports and deletion use tenant-specific prefixes. Existing integration coverage includes purge leaving another tenant's data intact.
- OAuth client ownership queries and workspace-member operations are scoped. New real PKCE/D1 integration verifies token acceptance before disconnect and rejection afterward.
- No shared memory-result cache was found. Rate-limit state is separate from stored memories.
- Queue/workflow payloads carry tenant identity and processors select that graph. A delayed ingestion lifecycle defect was fixed below.

## Fixes and independent review

1. A source/conversation message delivered after its canonical ingestion job was purged previously continued ingesting. The processor now returns its existing empty-result shape without mutation when the job no longer exists. Two regressions fail on original code and pass with the guard. Normal asynchronous ingestion remains covered by the full emulator suite.
2. Stateless signed MCP tokens previously passed verification even after disconnect/client disable/account deletion. The handler now checks current D1 user/client/consent state, issue time and scopes before graph selection. Eleven signed-token unit cases cover invalid grants, scope changes, subjects, disabled/deleted state and normal shared public-client use. These use real signatures with D1/transport doubles.
3. The existing HTTP auth test now exchanges a real PKCE code with the local provider and uses real D1 consent. It proves header-only access is rejected, an issued token is accepted, and the identical token is rejected after connection deletion. `MF-Original-URL` forces the non-local authorization branch inside Miniflare while all network traffic stays on loopback; Host alone did not do this. This is stronger than a localhost header-mode MCP test.
4. Migration `0004_oauth_consent_lookup.sql` and the schema add a nonunique `(user_id, client_id)` index for the per-request consent lookup. All migrations applied to an in-memory SQLite database; EXPLAIN QUERY PLAN used the new index. Selected real PKCE/session integration passed after the migration was added. Apply this migration via the approved deployment process before relying on production performance; it was not applied remotely.
5. The integration helper now respects explicitly supplied TMPDIR/XDG_CONFIG_HOME so isolated callers do not silently share the default tool configuration directory.

Independent reviewers examined tenant boundaries, background/vector architecture, the fixes, integration assertions and migration. No additional blocking regression was found in the bounded patch. This was compound-engineering-style read/reproduce/fix/test and independent review, not a complete security audit or formal CE whole-repository review receipt.

## Results

- Initial exploratory integration: 16/16 passed in 56.75 seconds; the ingestion guard had already landed during setup, so this is not labeled untouched-main baseline. The earlier reported integration hang was not reproduced.
- Final local unit + integration suite: **112/112 across 14 files**, 47.47 seconds. Live production test file explicitly excluded.
- Real-session/PKCE test rerun after index and config-path changes: passed in 2.82 seconds.
- Headless Chromium local browser suite: **2/2**, 25.6 seconds, one worker, server reuse disabled. Screenshot artifacts retained.
- MCP SDK smoke: exit 0, local streamable HTTP and configured request profiles. This does not constitute real Cursor/Claude/ChatGPT evidence.
- Web build and shell: passed. Web bundle budget: passed for six chunks.
- API and test typechecks passed after changes; final serial checks cover all six TS projects.
- Source lint: passed, 107 files, no fixes. Generated Playwright caches initially polluted the lint walk; moved to sibling SSD artifact storage and reran successfully. Source lint was not weakened.
- Recall: MRR **1.0** (minimum 0.84), Hit@3 **1.0** (minimum 0.90).
- Local graph recall: 220 memories **6.04 ms**, 360 **7.36 ms**, 1,000 **26.68 ms**, each below 7,500 ms. These are emulator measurements, not hosted latency promises.
- Lightweight safety/profile/evidence checks rerun separately; status checks retain pending external gates. Launch-evidence validation still permits the old July evidence and is not proof of candidate freshness.

Reproduction commands (from isolated checkout):

```sh
bun run build:web-shell
bun run web:bundle:check
node_modules/.bin/vitest run packages/core/src packages/client/src apps/web/src apps/api/test --exclude '**/live.e2e.test.ts' --maxWorkers=1 --no-file-parallelism --no-cache
bun scripts/mcp-sdk-smoke.ts
OPENMEMORY_SCALE_GRAPH_SIZE=360 node_modules/.bin/vitest run apps/api/test/http.integration.test.ts -t 'graph stats and recall stay bounded' --maxWorkers=1 --no-file-parallelism --no-cache
OPENMEMORY_SCALE_GRAPH_SIZE=1000 node_modules/.bin/vitest run apps/api/test/http.integration.test.ts -t 'graph stats and recall stay bounded' --maxWorkers=1 --no-file-parallelism --no-cache
node_modules/.bin/tsc -p apps/api/tsconfig.json --noEmit --incremental false
node_modules/.bin/tsc -p apps/api/test/tsconfig.json --noEmit --incremental false
node_modules/.bin/biome check .
```

Executions used a sanitized environment, low process priority, isolated HOME/XDG_CONFIG_HOME/TMPDIR and existing dependencies/browsers on the SSD. Browser testing used a temporary configuration derived from `playwright.local.config.ts`, with one worker, explicit checkout cwd and `reuseExistingServer: false`. No simulator/device processes were stopped. External SSD still had about 241 GiB free.

Local evidence root: `/Volumes/CrucialX10/andrewbierman/Code/openmemory-validation-artifacts-20261017/results/` (full test log, browser log, PKCE/index rerun, build log, benchmark JSONL, query plan and final check log). Screenshots remain under this checkout's `.tmp/screenshots/launch-readiness/`. Temporary browser config and runtime caches are in the sibling artifact directory.

## Remaining release limits and next work

- **In-flight deletion race:** the job guard prevents deliveries beginning after purge. An ingestion already past its initial job check can still race with purge. Generation fencing/cancellation is needed for a full concurrent-deletion guarantee.
- **Re-consent/token lifecycle:** current-grant enforcement is not an irreversible token denylist. Same-second revoke/regrant can reactivate an older token, and later consent scope expansion can restore older token scopes. Use persisted grant generation or equivalent revocation semantics before promising permanent revocation across re-consent.
- Graph edge creation accepts nonexistent/foreign-looking IDs into the caller's own graph. No cross-tenant disclosure was demonstrated; clarify/enforce endpoint existence if graph semantics require it.
- Queue payload parsing and workflow-ID tenant namespacing deserve additional hardening; no cross-tenant read exploit was demonstrated here.
- Drizzle's journal/snapshot still only covers initial migration 0000, while subsequent migrations are manual. Reconcile before relying on future db:generate output.
- Live Workers AI/Vectorize traces, rerank posture, deployed binding/revision parity, and current operational evidence remain unqualified by emulator tests. Wrangler warns AI is remote-only and Vectorize lacks local parity; no production credentials were provisioned for this pass.
- Real Cursor/Claude/ChatGPT OAuth and tool use remain pending. They require explicit authorization for a designated hosted test tenant, public PKCE clients, consent and disposable data cleanup. Generic SDK profiles do not replace them.
- Main still points at c85ed66; these commits are local only. Refresh candidate-bound release evidence after approved review/integration of the fixes. Do not relabel old production evidence or change required gates to bypass them.

Recommended next step: review the two local fixes, address the remaining lifecycle guarantees before broad production claims, then approve narrowly scoped live/vendor qualification. Release/deploy/merge remains a separate approval.
