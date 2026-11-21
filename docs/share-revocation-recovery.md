# Share revocation recovery

Shared-memory revocation spans the owner Durable Object and the D1 share directory; it is not one atomic transaction. The server first revokes the authoritative grant in the owner graph, then deletes the directory row. A directory row alone never authorizes a read.

If D1 cleanup fails after the grant is revoked, the endpoint returns HTTP 503 with `workspace_unavailable`. The row can remain in D1, but shared GET returns 404 and list/search omit the grant. This failure does not undo revocation or delete the personal memory. After storage recovers, the same authenticated owner can retry DELETE on the same share URL. Revoking an already-revoked grant is idempotent; a successful retry removes the stale directory row and returns `{ "revoked": true }`. Repeating DELETE remains successful.

The local integration regression injects a real D1 BEFORE DELETE trigger abort for one share, after the Durable Object operation commits. It checks the retained row, denied reads/list/search, sanitized failure response, successful cleanup on retry, repeated retry, and unchanged unrelated tenant memory and sharing. No authorization or storage responses are mocked. The trigger and its control endpoint exist only in the local test entrypoint.

This proves recovery for that specific failure boundary. It does not establish atomic account deletion, process-crash recovery, provider cleanup guarantees, concurrent re-sharing behavior, or deployed isolation. A lost success response can be handled by retrying the same share DELETE while the owner can still authenticate; the test exercises repeated success, not a real network disconnect. No automatic retry or background reconciliation is introduced.
