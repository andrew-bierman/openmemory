# Passwordless authentication rollout

Better Auth and its OAuth provider remain the customer identity and MCP authorization layers. Cloudflare Access is optional for internal tools; it is not a customer gate or customer-count limit. This change introduces no customer cap.

## Configuration and security

Provision users explicitly with their existing IDs and put normalized emails in OPENMEMORY_AUTH_ALLOWED_EMAILS. OTP never implicitly signs up a user. Empty admission configuration denies access. Google/GitHub buttons appear only when both provider values are configured; linking requires matching verified emails and is explicit.

AUTH_EMAIL is an unconfigured service binding whose fetch(Request) receives JSON {email, otp, type: "sign-in", expiresIn: 300}. It must reliably send the email before returning a successful Response. A private Resend adapter is prepared in apps/auth-email with injected local tests. Andrew selected his existing Resend account; exact sender/domain and scoped key remain pending. No live credentials or delivery configuration were created. Delivery is awaited; missing/failed delivery denies login. OTPs must never be logged.

Codes have six digits, five-minute expiry, HMAC-hashed storage and atomic D1 consumption. Send limits are 3/email and 10/IP per 15 minutes; verification limits 5/email and 30/IP per 5 minutes, plus five attempts per code. Counters are durable and atomic for HTTP and auth.api calls. Missing IP shares a conservative bucket; trust CF-Connecting-IP only behind Cloudflare's overwriting proxy.

Password registration/login/reset/change/set are disabled server-side, including the pathless auth.api.setPassword method. Unused OTP endpoints are absent. Cookie caching is disabled. Admission is checked for sessions, social profiles, OAuth issuance/refresh and each MCP token. Existing team membership/grant checks remain authoritative.

Migration 0007 adds OTP/throttle tables only. No user IDs, memberships, grants, sessions or credential records are deleted. Password hashes remain stored but unusable after cutover; deletion requires a separate approved migration. Email OTP is phishable and inherits mailbox security; passkeys may be added later.

## Safe existing-user migration

1. Inventory existing emails, verified-email state, linked providers, case-insensitive collisions and mailbox access. Preserve exact user IDs; resolve collisions or inaccessible mailboxes before rollout.
2. Back up D1 and prove restore in isolation. Prepare the additive migration and exact invitation list without applying production changes.
3. Configure real delivery in isolated staging and test OTP, failure/throttle paths, session revocation, MCP OAuth/PKCE refresh and old-token membership removal.
4. Before disabling any existing user's only working login, prove passwordless access for that user with their existing identity in an explicitly approved migration rehearsal. If every affected user cannot complete this proof, production cutover is blocked: leave the current production deployment running and design a transitional enrollment release separately. This candidate deliberately has no password fallback.
5. Obtain approval for the qualified code, additive schema and exact configuration. Preserve the auth secret; compare IDs, memberships and grants before/after. Never mark email verified merely because it is invited.
6. Retained credentials allow rollback to the recorded old release. Re-enabling password login changes security posture and requires explicit approval. Do not drop the additive tables during rollback.

## App-auth-only staging and approvals

Invitation-only app authentication can protect data without Access after route/session/token qualification. Login, assets, OAuth discovery and dynamic client registration remain public. Rate controls do not make ingress private or establish a spending cap. Access remains an optional internal ingress choice, not a prerequisite for customer auth.

Remaining approvals: existing Resend account scope, sender/domain verification and scoped service binding/secret; exact synthetic recipients and user/admission provisioning; named isolated staging resources and deployment/run budget; real OAuth grants where needed. Production cutover, credential deletion and teardown are separate actions. No real mail, deployment, Access activation or credentials are authorized by this local code change.

## Evidence and limits

The local implementation was checked against installed Better Auth 1.6.14 source, not just current online documentation. Official references: [Email OTP](https://better-auth.com/docs/plugins/email-otp), [rate limits](https://better-auth.com/docs/concepts/rate-limit), [users/accounts](https://better-auth.com/docs/concepts/users-accounts), [session management](https://better-auth.com/docs/concepts/session-management), [security](https://better-auth.com/docs/reference/security), and [SSO](https://better-auth.com/docs/plugins/sso).

Local D1 tests exercise atomic consume, throttles, expiry, HTTP/direct API password denial and legacy identity preservation. Headless browser tests exercise the real code-entry page and OAuth callback using a synthetic mailbox, not real delivery or vendor evidence. Independent local review retained no primary findings after fixes. Configured Google/GitHub callbacks/linking and real delivery still require qualification before enabling those providers. Generic send bodies do not claim constant-time behavior. Delivery has no explicit application timeout; an unavailable or stalled transport must be operationally handled and qualified before live rollout.
