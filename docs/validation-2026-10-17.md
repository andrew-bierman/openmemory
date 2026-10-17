# Local validation and tenant review — 2026-10-17

Source candidate: `c85ed66f9b35588506e2e2550ee3705c5e4b4201`.
Implementation commits: `f8f697f` (delayed ingestion guard), `988042d` (current OAuth grant enforcement, lookup index, tenant tests), `49649e9` (durable lifecycle/vector fencing), `db4a251` (access/refresh/code consent-generation binding).
Branch: `codex/tenant-validation-20261017`.

This pass strengthens local confidence; it does not certify broad hosted launch. No production mutation, credential grant, deployment, push, merge, tag, or publication was performed. The original checkout remained clean and unchanged.

## Architecture and tenancy

The runtime is Cloudflare-native: Workers serves API/MCP and static UI assets; named SQLite Durable Objects store graphs; D1 stores Better Auth and account/control-plane data; Workers AI and Vectorize supply semantic retrieval; R2 stores exports; Queues and Workflows perform ingestion/extraction, with dead-letter queues; Analytics Engine and cron support monitoring. Both Wrangler configurations declare these bindings and code consumes them. This audit did not independently verify deployed binding parity.

React/TanStack, Elysia, Drizzle, Better Auth, the MCP SDK and Cloudflare Agents SDK are application libraries, not additional required hosted databases or AI providers. Optional external integrations are GitHub/Google social login and alert webhook/email/PagerDuty destinations. No architectural rewrite is warranted by this review.

Personal memory tenancy is per authenticated **user**, separate from the team/account workspace. `auth.ts` derives the tenant from session user ID and selects `MEMORY_GRAPHS.idFromName(tenantId)`. Production MCP derives identity from a verified token; request-supplied tenant headers are development-only. The team follow-up below adds explicit accepted membership and selected-version grants; personal retrieval never derives authority from workspace membership.

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

## Team implementation follow-up

The approved plan is `docs/plans/2026-10-17-010-team-accounts-plan.md`. Workspaces are team/account identities separate from users. U1 (`d57ca99`) adds accepted membership, single-use hashed invitation capabilities and role boundaries, with migration `0006_team_accounts.sql`. Existing owners stay accepted; legacy non-owner rows are invitation-only and no memories are automatically shared. U2 (`4a1fb12`) adds owner-authoritative selected-version grants. U3 REST/client (`0549687`) rechecks recipient and sharer membership identities and the authoritative grant before projecting content. Its real three-user HTTP test covers private isolation, explicit acceptance, role denial, removal/rejoin, revocation, and team deletion preserving personal graphs.

An independent interim review found that retrying an old share request after purge/restore could capture the new generation and recreate access. The regression reproduced HTTP-equivalent current-generation replay returning 200 instead of 409. Fix `ffdb257` retains minimal consumed request-ID tombstones across purge, including process restart; a genuinely new request ID is required to share restored content. Grant details/audit/content remain purgeable and are excluded from graph export. Real HTTP testing also caught raw user IDs selecting a different DO from the normalized personal tenant ID; owner graph selection now follows the same normalization as existing private APIs.

The MCP follow-up adds explicit shared read tools and scope without expanding default personal consent. Its real local PKCE test checks personal-token denial, successful shared list/read/search, private recall isolation, share revocation, membership removal and OAuth disconnection. It uses actual local D1/DO/provider flows; this is not real Cursor/Claude/ChatGPT evidence. Shared service concurrency barriers separately cover revocation observed before final checks. Authorization is not a global transaction across D1 and DOs; previously returned data and already-authorized concurrent responses cannot be retracted.

Apply migration 0006 after 0004/0005 only through a separately approved deployment. No production migration, deployment, credential creation, external invitation, grant, push or publication occurred. Complete final integrated browser/code review and candidate qualification before treating this implementation as ready; live vendor/RAG gates above remain outstanding.

### Migration verification before enabling traffic

During the separately approved deployment window, apply migrations 0004, 0005 and 0006 in order, then run these read-only assertions on the target D1 database before allowing new invitations or shares. Every count should be zero and `foreign_key_check` should return no rows. Preserve a pre-migration backup and investigate any mismatch; do not repair by accepting legacy non-owner memberships. A missing historical owner membership requires reviewed repair using the stable workspace owner user ID.

```sql
PRAGMA foreign_key_check;
SELECT count(*) AS missing_or_invalid_owner_memberships
FROM workspace w LEFT JOIN workspace_member m
  ON m.workspace_id=w.id AND m.user_id=w.owner_user_id
WHERE m.id IS NULL OR m.role<>'owner' OR m.status<>'active'
  OR m.accepted_at IS NULL;
SELECT count(*) AS implicitly_accepted_nonowners
FROM workspace_member m JOIN workspace w ON w.id=m.workspace_id
WHERE m.user_id<>w.owner_user_id AND m.accepted_at IS NOT NULL;
SELECT count(*) AS duplicate_accepted_memberships FROM (
  SELECT workspace_id,user_id FROM workspace_member
  WHERE accepted_at IS NOT NULL GROUP BY workspace_id,user_id HAVING count(*)>1
);
SELECT count(*) AS unexpected_initial_shares FROM workspace_share_directory;
SELECT count(*) AS unexpected_initial_invitations FROM workspace_invitation;
SELECT count(*) AS unbound_consents FROM oauth_consent WHERE grant_version='';
```

The zero-share, zero-invitation and zero-accepted-nonowner assertions apply immediately after first migration, not after legitimate team activity. Verify index `workspace_member_user_idx` and `workspace_share_directory_page_idx` plus migration records before enabling compatible code. After deployment, use separately approved disposable accounts to verify invite acceptance/replay, private versus shared reads, removal/rejoin, revocation, workspace deletion and shared OAuth consent. Never substitute these local tests for those deployment checks.

Final review also reproduced a dashboard account-switch exposure while the next user's memory request was paused; identity-scoped query keys and cancellation discard previous-user data. A separate focus regression preserves an invitation secret during successful same-membership reauthorization while clearing shared results before reload. MCP `shared_workspaces` provides accepted IDs/names/roles so clients can discover shared resources without administration authority. Local 26-share pagination returned 25 then 1 with no duplicates or missing records; its first page took 83.87 ms in one emulator run. Per-item fresh checks remain deliberately uncached; hosted fan-out latency needs deployment measurement.
