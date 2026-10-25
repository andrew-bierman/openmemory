# Combined cloud qualification — 2026-10-25

## Source lineage and scope

Remote main was `c85ed66f9b35588506e2e2550ee3705c5e4b4201`. Recovery branch
`codex/local-qualified-20261018` was fetched and verified at
`1fb356bf4c63d437f5c6e146cd5181bdc635598b` (35 commits ahead of main).
The combined code candidate is `4b5feb2b19613f166fa61450bd5afd71b77b8621`.

An isolated worktree/branch started at that recovery commit. Five source/test
file hunks from cloud candidate `3a99315bab2ef2352bb3e3812e32e51778f30c5e`
were applied with three-way Git patch application, not tree replacement.
Recovered team membership, private-by-default sharing, explicit shared OAuth
scope, grant/revocation fencing, passwordless admission and email work remain
in history. The original cloud branch and its three commits remain untouched.
Its obsolete missing-source handoff document was not imported.

Dashboard OAuth client creation now authenticates before bounded JSON parsing.
It accepts application/json (including parameters), counts actual streamed bytes
up to 64 KiB, validates input shape, and returns fixed JSON 400/413/415 errors.
Default personal scopes remain separate from opt-in `memory:shared:read`.
This does not change Better Auth's dynamic-registration route. The reader bounds
bytes but does not add an application-level read deadline.

## Executed local qualification

Linux, Node 24.19.0, Bun 1.3.14, frozen lockfile installation. All results below
were executed on the combined source; neither historical 267-test nor earlier
cloud 103-test results are counted as qualification of this combination.

- Full forced `bun run check`: passed: 275 TypeScript tests (226 API/email, 31 web,
  11 core, 7 client), two live tests skipped, plus the real SQLite email-budget
  concurrency test. All 10 tasks passed with zero cache hits; this includes
  team/OTP/isolation, shared PKCE, revocation/race and Worker integration tests.
- Production build and bundle budgets: passed.
- Local MCP SDK profiles: passed. Profiles are not real vendor OAuth evidence.
- Chromium browser suite: 3/3 passed (dashboard, OAuth callback, accepted team
  sharing/revocation and privacy). Used existing `/usr/bin/chromium`, one worker,
  an ignored config derived from playwright.local.config.ts, fresh fixture state
  and the synthetic mailbox. No real email was sent.
- 360-memory and 1,000-memory local scale gates: passed, at 20.41 ms and
  47.99 ms recall respectively against the 7,500 ms assertion.
- Type checks include API source/tests and the private email adapter.

The first full check exposed four fixture startup failures because Turbo's
strict environment discarded the supplied writable XDG config directory.
`@openmemory/api#test` now passes through only XDG_CONFIG_HOME and
WRANGLER_SEND_METRICS. A multi-actor team REST test also had an implicit five-second
timeout; it now uses the same explicit 45-second allowance as neighboring Worker
integration cases. Its assertions and recall performance thresholds were not
weakened. The focused team test then passed in approximately five seconds.
Generated local JSON artifacts briefly failed Biome formatting; formatting those
ignored artifacts resolved that separate pre-test failure.

Logs and scale JSONL evidence are retained in `.tmp/combined-qualification/` and
are not committed. No live tests, production migrations, deployment, external
invitations, real email sends, credentials or customer-data changes occurred.

## Review and publication scan

A separate read-only reviewer inspected all five OAuth integration files and
sampled recovered session/OTP, current-grant revocation, membership and owner
share-projection paths. It confirmed authentication precedes body parsing,
shared consent remains opt-in, and production Wrangler entrypoints exclude
synthetic session fixtures. No integration-blocking finding remained. The two
test-harness fixes were also independently reviewed. This was not an exhaustive
security audit of all 35 recovered commits or any hosted runtime.

The repository secret scanner passed on all 35 recovered commit snapshots and
commit metadata. The combined working tree and the additional integration commit also passed
the scanner; supplemental token/JWT/credential-URL patterns found no matches
in 12,226 added lines across recovery history and the integration patch.. These are pattern scans, not a guarantee of
secret absence: broad placeholder allow rules apply; Git internals, lockfiles,
common generated/dependency directories, listed binary/image/PDF extensions and
NUL-containing files are excluded. Ancestors before main and remote runtime
secrets were not audited. Synthetic fixture values were distinguished from
actual credentials; no matched value is published in scan output.

## Remaining release gates

This candidate is suitable for draft code review, **not production cutover**.

1. Review the complete recovery/integration diff and obtain green draft-PR CI.
2. Separately approve and verify additive D1 migrations 0004–0007, backup/restore,
   owner-membership invariants, deployed revision/binding parity and rollback.
   Verify target migration state before using the revised 0006; never silently
   rerun an earlier applied version. No production schema work occurred here.
3. Approve sender/domain, scoped Resend sending key, exact controlled recipients,
   private service binding and bounded staging configuration/resources. Prove
   real delivery and browser OTP, expiry/replay/revoked-admission behavior.
4. Prove every affected existing user can access the preserved identity before
   disabling their only working login. This candidate disables password APIs
   and implicit signup; historical local tests do not authorize cutover.
5. Complete actual Cursor, Claude and ChatGPT OAuth/MCP dogfooding. Historical
   Inspector evidence and local SDK profiles do not qualify those vendors.
6. Complete production semantic RAG trace/quality and rerank posture review;
   measure shared-read fan-out, queue/DLQ health and refresh hosted evidence for
   the exact deployed candidate. Local provider doubles and scale tests do not
   qualify hosted quality/latency.
7. GitHub/Google social OAuth remains disabled/optional. If enabled, qualify its
   callbacks and account linking separately. Production deploy/release still
   requires separate authorization.

Historical runtime/build/cleanup evidence in config/launch-evidence.json is
retained with its original commit identity. These are Linux and browser results;
no Apple/native acceptance is claimed.
