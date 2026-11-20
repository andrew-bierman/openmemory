# Private passwordless email adapter

Local implementation only. No account, sender, key, binding, database or deployment is configured. Andrew selected his existing Resend account; sender/domain approval is pending. The example has invalid placeholders and must not be deployed as-is.

Bind this Worker to the API's `AUTH_EMAIL` service binding. It has no public routes, workers.dev or preview URL. Only trusted bound Workers may call it: this is a service boundary, not a public HTTP authentication endpoint. It accepts only POST `/send`, JSON `{email,otp,type:"sign-in",expiresIn:300}` and an exact configured recipient allowlist. Sender is a fixed bare mailbox from deployment configuration. Recipient configuration has no user-count cap. Never enable request/body tracing on this Worker or expose it through a public proxy.

`RESEND_API_KEY` must be an approved sending-only key scoped to the verified sender domain, stored as a Worker secret. Native fetch sends one request to `https://api.resend.com/emails`, refuses redirects and waits for successful provider acceptance with a valid UUID. It does not retry, log payloads, forward provider errors, or assert inbox delivery. The API invalidates an OTP if this adapter fails. A timeout can occur after Resend accepted a message; a late email then contains an invalidated code. Unknown provider acceptance is never retried automatically.

Each request body is capped at 1024 bytes and ten seconds; provider response is capped at 4096 bytes, and reservation plus provider processing has a separate ten-second total deadline. Aborting native fetch is best effort; the deadline also races an injected fetch that ignores abort. `createAuthEmailWorker({fetch,now})` enables offline verification without credentials or network calls.

## Bounded staging

Set `AUTH_EMAIL_MODE=staging`, exact `AUTH_EMAIL_ALLOWED_RECIPIENTS`, approved `AUTH_EMAIL_RUN_ID`, ISO `AUTH_EMAIL_RUN_EXPIRES_AT`, and `SEND_BUDGET_DB`. Apply the separate additive migration here to the approved email-budget database, not the customer auth database. One atomic SQL reservation consumes one of twelve attempts before contacting Resend. Failures count; concurrent requests cannot exceed twelve reservations. Expiry is immutable per run, expired runs remain closed, and no cleanup/reset/delete is provided. Changing a run ID, recipient list or cutoff requires a fresh approval. Deployment configuration is the approval boundary; callers cannot choose these values.

Explicit `AUTH_EMAIL_MODE=production` retains the exact recipient allowlist but does not use the staging-run budget. This permits normal service after a separately approved production cutover; it is not a request-controlled bypass. Upstream durable per-IP/per-email OTP limits remain required. Production recipient allowlist updates follow the app's admission process.

## Remaining setup and evidence

Before any send: approve sender/domain in the existing Resend account, verify its required DNS records, issue the scoped send-only key, approve exact controlled test recipients and UTC run cutoff, approve account/resources and migration, review final staging configuration, deploy this private Worker, and bind only the staging API. No deployment or migration commands have been run. No actual delivery, domain verification, spam placement, or provider account limits have been verified. Use the bounded approval packet; these files confer no execution approval.

Local verification:

```
node_modules/.bin/vitest run apps/auth-email/test --maxWorkers=1 --no-file-parallelism --no-cache
node_modules/.bin/tsc -p apps/auth-email/tsconfig.json
python3 apps/auth-email/test/budget_sql_test.py
```

Tests use fake fetch, native local SQLite, and real local workerd-backed D1 in apps/api/test/passwordless.integration.test.ts. The latter also proves the real OTP endpoint accepts successful adapter delivery, invalidates a code after provider failure, and caps concurrent adapter instances at twelve sends. A hosted service-binding and real inbox-delivery check is still required.
