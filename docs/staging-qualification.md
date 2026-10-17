# Bounded staging authentication qualification

`scripts/staging-qualification.ts` exports `qualifyStaging(approval, dependencies)` and has no CLI, environment lookup or import-time requests. The operator supplies the exact approved fixture identities, explicit run window and trusted transport, clock and controlled OTP reader. It must only be invoked after the staging packet's account, domain, sender, recipient, provisioning and deployment approvals are complete. Resend is selected; domain/sender and exact recipients remain pending. No live run has occurred.

The fixed origin is `https://om-qual-20261017-api.abbierman101.workers.dev`; the fixed run ID is `om-qual-20261017-otp-1`. Supply three distinct lowercase email addresses, user IDs and tenant IDs for already provisioned A/B/C. `approved: true` records an existing explicit approval; it does not obtain approval. `startAt`/`cutoffAt` are UTC epoch milliseconds, no more than 45 minutes apart. `maxRequests` must be 1–240 and `maxSends` 1–12. Lower budgets are supported and stop the scenario when exhausted.

A successful invocation makes exactly 16 application requests and attempts three sends:

1. For each A/B/C, request a sign-in OTP and obtain the delivered code through the supplied controlled reader.
2. Verify the code, retain only the secure session cookie in memory, then check `/api/auth/get-session` and `/v1/account` against the exact approved email, user ID and tenant ID.
3. Read `/v1/readiness`, checking that its tenant matches the fixture.
4. Validate the MCP protected-resource document's exact resource and authorization-server discovery URL.

The harness makes no application content writes, provisions no users, invokes no deletion endpoint, and has no cleanup block. OTP send/verification create authentication state as expected. Authenticated identity checks happen before any further scenario work; this reduced scenario has no memory or membership mutation. Readiness here proves the tenant boundary and endpoint response, not full production semantic health.

The only POST bodies are fixed OTP send/verify shapes. Every request uses the fixed origin with `redirect: manual`; redirects, cross-origin response URLs and non-success statuses stop the run. Attempts count before network I/O and are never retried. JSON reads are capped at 64 KiB and their streams are canceled on completion/failure. Requests and body reads have ten-second deadlines; the OTP reader has at most 120 seconds and never exceeds the run cutoff. Both transport and OTP reader receive abort signals and must honor them. The runner returns sanitized typed outcomes/counts, never provider response bodies, recipient identities, cookies, tokens or codes. The injected dependencies must also avoid logging or persisting these values. Mailbox receipt is only as trustworthy as the injected reader; fake-reader local tests prove no actual delivery.

Budgets and pacing are invocation-local, not an account-wide or durable limiter. This fixed scenario sends once per identity and three times per source IP, below 3/email and 10/IP per 15 minutes. Do not rerun, invoke concurrently or combine with other traffic under the same approval. An operator must account for prior traffic and the adapter must enforce the packet's durable 12-attempt run cap. The approval object cannot establish that no separate process used the same run ID. Stopping here does not close the staging Worker: the approved operator closure procedure is still required at cutoff.

## Coverage still required

This minimum harness does not replace browser OTP completion, expiry/replay/removed-admission probes, member revocation/rejoin, memory isolation and semantic recall, R2 exports, synthetic PKCE consent/token/refresh, actual Cursor/Claude/ChatGPT checks, background queue monitoring or existing-user migration proof. These remain separately bounded packet steps requiring reviewed implementations before execution. Discovery evidence is not vendor interoperability evidence. No optional AI reranking is enabled.

Local validation:

```sh
node_modules/.bin/vitest run apps/api/test/staging-qualification.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
node_modules/.bin/tsc -p apps/api/test/tsconfig.json --noEmit --incremental false
```

The tests inject transport and clock, use synthetic mailbox values and check success, missing approval, wrong origin, invalid windows/identities, identity mismatch, redirects, transport failures, enlarged/exhausted budgets, cutoff after OTP reading, malformed OTPs, bounded transport timeout and sanitized evidence. They send no email and make no live requests.
