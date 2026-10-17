# Passwordless live qualification

These runners use an externally supplied, fresh Better Auth session obtained through the approved email OTP flow. They do not provision users or send email. The UI runner measures authenticated UI behavior, not OTP delivery or login UI. Actual delivery/login needs separate evidence. CI live jobs are blocked until approved disposable fixtures and delivery are configured; enabled runs fail rather than silently skip missing setup.

Every runner requires `OPENMEMORY_LIVE_BASE_URL` as an explicit HTTPS origin. Never supply production user sessions. Provision distinct, disposable synthetic accounts and dedicated tenants outside these runners, with the same private-beta invitation/allowlist enforcement as ordinary users. Preserve real users and existing grants.

Use the appropriate environment prefix:

| Runner | Prefix |
| --- | --- |
| HTTP live E2E | `OPENMEMORY_LIVE_E2E` |
| Graph benchmark | `OPENMEMORY_LIVE_BENCHMARK` |
| MCP Inspector | `OPENMEMORY_LIVE_INSPECTOR` |
| Browser UI | `OPENMEMORY_LIVE_UI` |

For each prefix, configure `_EMAIL`, `_TENANT_ID`, `_SESSION_COOKIE` (Cookie request header, not Set-Cookie), and `_DISPOSABLE_APPROVAL`. The approval must equal the exact concatenation `<email>:<tenant-id>`. This acknowledges the runner's existing mutations, OAuth client/grant creation, and deletion of that disposable account and its tenant data. It is not a substitute for the owner's live execution approval. Obtain that approval for the exact origin, identities and workload first. Never commit or print cookie values. Distinct prefixes must identify distinct accounts because successful runs delete their accounts.

The browser runner additionally requires `OPENMEMORY_LIVE_UI_INVITE_EMAIL` and matching `OPENMEMORY_LIVE_UI_INVITE_APPROVAL` for its invitation/removal test. This recipient must also be approved and disposable. Browser traces, screenshots and video are disabled in this spec to avoid storing sessions. Operator-level logs and shell history still require credential hygiene.

Missing fixture configuration fails before the runner makes any network request. Before fixture writes, the runner reads `/v1/account` and requires exact email and tenant matches. Mismatches do not authorize cleanup. Cleanup uses the explicitly approved identity and rechecks current identity immediately beforehand. Read-only account validation is required even with a supplied session. Redirects on HTTP authentication checks are not followed.

The runner scope is broader than the small staging proposal: source ingestion, index repair, exports, OAuth consent and destructive account cleanup may be included. Do not execute these runners under approval for a smaller workload. A failed browser run may leave synthetic fixtures behind; inspect them and obtain scoped cleanup approval rather than broad deletion. Inspector failures with subprocess output omit that output to avoid exposing its bearer header.

No live run was performed for this migration. No provider credentials, accounts, email delivery, staging deployment, Access activation or cloud resources were created. Invitation-only application authorization can be evaluated without an Access customer gate; these runner changes alone do not establish that security result or impose a customer count cap.
