# Local validation and tenant review — 2026-10-17

Source candidate: `c85ed66f9b35588506e2e2550ee3705c5e4b4201`.
Implementation commits: `f8f697f` (delayed ingestion guard), `988042d` (current OAuth grant enforcement, lookup index, tenant tests), `49649e9` (durable lifecycle/vector fencing), `db4a251` (access/refresh/code consent-generation binding).
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

## Initial qualification results (before lifecycle follow-up)

- Initial exploratory integration: 16/16 passed in 56.75 seconds; the ingestion guard had already landed during setup, so this is not labeled untouched-main baseline. The earlier reported integration hang was not reproduced.
- Initial complete local unit + integration suite: **112/112 across 14 files**, 47.47 seconds. Live production test file explicitly excluded.
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

## Lifecycle follow-up and final qualification

The two remaining lifecycle defects were reproduced and fixed on this isolated branch:

- Durable Object generation fencing now covers source/conversation chunks, graph edges, extraction, completion and failure. Purge/restore increments a persistent generation. Legacy deliveries belong to generation zero; stale work cannot alter a new job reusing the same ID. Completed-job retries no-op. Queue identifiers and generation values are validated; workflow IDs hash tenant, resource and generation.
- Account deletion also persists a retired marker. Even an already-authenticated caller using a fresh or omitted generation cannot recreate that account's graph. Normal tenant purge remains reusable. The real SQLite DO fixture verifies fences, restore, retirement and tenant isolation across process restarts.
- Vector IDs and tenant metadata partitions include generation after the initial generation; generation zero retains existing IDs. Indexing rehydrates canonical data and checks generation. A delayed upsert or cleanup cannot overwrite/delete a same-ID restored vector. Search and diagnostics use the current partition; repair cleanup passes its captured generation. Provider failures may leave old vectors physically stored, but these are excluded from current-generation retrieval. This is not a guarantee of immediate physical deletion across providers, crashes or in-flight R2 exports.
- OAuth artifacts carry the original consent ID and persisted grant version. Migration `0005_oauth_grant_version.sql` backfills versions and rotates them on consent creation/scope changes. Supported provider hooks bind access tokens, refresh rotation and pending authorization codes before concurrent token generation. Old artifacts cannot acquire a new grant through same-second reconsent, scope shrink/re-expansion or delayed exchange. Real local PKCE/D1 tests cover native provider and app revocation, fresh rotation and two users using the same public client.

Independent follow-up review found no remaining blocking defect in these changed paths after the repair-generation callsite fix. No complete security audit is claimed.

Final combined qualification: **140 tests passed across 19 files, 53.33 seconds**, with the live-production test file excluded. This includes all 16 existing HTTP integration scenarios, the real DO restart fixture, generation-qualified vector tests, controlled ingestion race barriers, signed JWT tests and real PKCE/D1 exchanges. All six TypeScript projects passed; Biome checked 116 files without changes; `git diff --check` passed. Earlier build, SDK and scale results above remain separately labeled evidence from before this follow-up. Final headless Chromium browser rerun: **2/2 passed, 19.4 seconds**, one worker and server reuse disabled.

Reproduction uses the same sequential Vitest command above, plus `node_modules/.bin/tsc -p <project>/tsconfig.json --noEmit --incremental false` for apps/api, apps/api/test, apps/web, packages/core, packages/client and packages/ui. Logs: `final-lifecycle-tests.log`, `final-lifecycle-types.log`, `final-lifecycle-lint.log`, `final-lifecycle-browser.log`. Regression evidence: `ingestion-races-red.log`, `ingestion-races-green.log`, `oauth-generation-red.txt`, `oauth-generation-green.txt`, `oauth-generation-integration.txt`, `oauth-migration-validation.txt`.

## Remaining release gates and minimal plan

1. Review/integrate the isolated branch; main remains at the source candidate. Apply D1 migrations 0004 and 0005 through the approved deployment process before deploying the auth changes. Existing unbound access tokens, refresh tokens and pending authorization codes intentionally fail closed and require reauthorization. DO lifecycle tables initialize lazily. No new Cloudflare service or metadata index is required.
2. Authorize a designated hosted test account and disposable data for actual Cursor, Claude and ChatGPT OAuth/MCP checks. Approval must cover public PKCE-client registration, the requested OAuth scopes/consent in each vendor, tool writes and cleanup. Generic SDK profiles cannot replace this evidence. Do not create credentials or grant consent silently.
3. Obtain approved production Workers AI/Vectorize traces and rerank-threshold review, and verify deployed revision/binding parity. Local provider doubles do not qualify semantic quality or hosted latency.
4. Refresh `config/launch-evidence.json` against the exact integrated/deployed candidate; it still references July's 3e4b35f. Today's successful analytics-only scheduled CI is not a full candidate qualification. Broad release remains blocked until the required vendor/RAG evidence is complete. Social GitHub/Google login is deliberately disabled for alpha and is not automatically a gate.
5. Obtain separate approval for production migration/deploy and release/tag/publish. None was performed here.

Maintenance notes: graph edges can still reference nonexistent IDs within the caller's own graph; no cross-tenant disclosure was shown. Drizzle's journal/snapshot only covers initial migration 0000 while later migrations are manual; reconcile before future generated migrations.

Optional team sharing remains **proposal only**, in the separate audit deliverable `team-sharing-proposal.md`. Current memories are private per user. The proposal recommends owner-controlled read-only selected-version references with explicitly accepted membership and a new shared-read OAuth scope, using existing Cloudflare services. Existing auto-active invitation rows and unrestricted personal graph expansion must not become implicit sharing authorization.
