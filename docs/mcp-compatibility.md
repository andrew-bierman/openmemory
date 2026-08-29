# MCP Compatibility Matrix

OpenMemory exposes MCP over streamable HTTP at `/mcp` using Cloudflare Agents'
Worker-native `createMcpHandler`. Production clients authenticate with OAuth
bearer tokens. Local integration tests use the development tenant header path
so protocol behavior can run in CI without external OAuth fixtures.

Named client request profiles live in
[`config/mcp-client-profiles.json`](../config/mcp-client-profiles.json). The
root `bun run check` gate validates that profile artifact, required OAuth
scopes, expected tools, and this compatibility matrix stay in sync.

Real external-client dogfooding evidence lives in
[`config/mcp-vendor-dogfood.json`](../config/mcp-vendor-dogfood.json). The
normal status check allows pending vendor evidence:

```sh
bun run mcp:vendor-dogfood:status
```

The strict launch gate fails until MCP Inspector, Cursor, Claude, and ChatGPT
entries are marked passed with evidence:

```sh
bun run mcp:vendor-dogfood:check
```

## Protocol Coverage

| Client behavior | Status | Evidence |
| --- | --- | --- |
| Streamable HTTP `POST /mcp` | Supported | `apps/api/test/http.integration.test.ts` posts JSON-RPC requests with `Accept: application/json, text/event-stream`. |
| OAuth protected resource discovery | Supported | Local and live tests validate `/.well-known/oauth-protected-resource/mcp`. |
| OAuth dynamic client registration | Supported | Local and live tests register Better Auth OAuth clients. |
| Dashboard OAuth client registration | Supported | Authenticated users can create, list, and disable public PKCE MCP clients through `/v1/oauth/clients`. |
| Authorization code with PKCE | Supported | Live API E2E exchanges a PKCE code for an MCP-scoped bearer token. |
| Browser OAuth callback redirect | Supported | Local and live browser E2E register a client with a randomized localhost callback listener, accept consent in the browser, capture `code` and `state`, exchange the code, and call MCP. Live browser E2E proves bearer-token MCP access; local browser E2E keeps the development tenant header for localhost MCP routing. |
| Bearer token audience validation | Supported | MCP verifies access-token audience against `<resource>/mcp`. |
| `initialize` handshake | Supported | Integration tests call `initialize` and assert OpenMemory server metadata and tool capability advertisement. |
| `notifications/initialized` | Supported | Integration tests assert the initialized notification is accepted as a 2xx request. |
| `tools/list` | Supported | Integration tests assert `remember`, `recall`, `profile`, and `forget` are advertised. |
| `tools/call` | Supported | Local and live tests call `remember`, `recall`, `profile`, and `forget`. |
| `resources/list` | Supported | Local and live tests assert `openmemory://profile` and `openmemory://recent` are advertised. |
| `resources/read` | Supported | Local and live tests read `openmemory://profile` and `openmemory://recent` and assert tenant memory context appears. |
| `prompts/list` | Supported | Local and live tests assert the `context` prompt is advertised. |
| `prompts/get` | Supported | Local and live tests call `context` and assert graph-aware tenant memory context appears. |
| Server-sent streaming tool results | Not required today | Tools return JSON responses. Streaming can be added later for long-running ingest or recall. |

## Named Client Dogfooding

| Client | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Official MCP TypeScript SDK `StreamableHTTPClientTransport` | Tested in CI | `bun run test:mcp:sdk` starts local Wrangler, connects to `/mcp`, lists tools/resources/prompts, calls `remember` and `recall`, reads `openmemory://profile` and `openmemory://recent`, and gets the `context` prompt. | Uses the local tenant header because CI cannot complete browser OAuth. Production clients should use OAuth. |
| MCP Inspector | Passed real Inspector CLI dogfood | `bun run mcp:inspector:live` creates a hosted throwaway account, registers a PKCE MCP client with the Inspector loopback callback, mints a bearer token, and runs `@modelcontextprotocol/inspector --cli` against production `/mcp` for tools, resources, and prompts. GitHub proof: `https://github.com/andrew-bierman/openmemory/actions/runs/33257516761`. | Strict dogfood evidence is tracked as `mcp-inspector` in `config/mcp-vendor-dogfood.json`. |
| Cursor | Config-shape smoke in CI plus generic browser callback verification; real vendor evidence pending | `bun run test:mcp:sdk` runs a `cursor-remote-mcp-config-shape` profile against `/mcp`; browser E2E proves the OAuth callback mechanics with a client-owned localhost listener. | Strict dogfood evidence is tracked as `cursor` in `config/mcp-vendor-dogfood.json`. |
| Claude remote MCP connector / Messages API MCP connector | Config-shape smoke in CI plus generic browser callback verification; real vendor evidence pending | `bun run test:mcp:sdk` runs a `claude-remote-mcp-config-shape` profile against `/mcp`; browser E2E proves the OAuth callback mechanics with a client-owned localhost listener. | Strict dogfood evidence is tracked as `claude` in `config/mcp-vendor-dogfood.json`. |
| ChatGPT connector / Apps SDK MCP client | Config-shape smoke in CI plus generic browser callback verification; real vendor evidence pending | `bun run test:mcp:sdk` runs a `chatgpt-connector-mcp-config-shape` profile against `/mcp`; browser E2E proves the OAuth callback mechanics with a client-owned localhost listener. | Strict dogfood evidence is tracked as `chatgpt` in `config/mcp-vendor-dogfood.json`. |

## Client Expectations

Generic MCP clients should use:

```txt
Transport: streamable-http
URL: https://openmemory-api.abbierman101.workers.dev/mcp
Accept: application/json, text/event-stream
Content-Type: application/json
Scopes: openid profile memory:read memory:write
```

For first-party or manual setup, sign in to the hosted dashboard and use the MCP
panel to create a public PKCE OAuth client. The dashboard returns the safe
client fields needed by MCP hosts and never exposes a client secret.

The checked profile artifact can be used as a starting point for client-specific
configuration:

```sh
bun run mcp:profiles:check
```

Clients should run the normal MCP handshake:

1. Discover OAuth metadata from `/.well-known/oauth-authorization-server/api/auth`.
2. Discover protected-resource metadata from `/.well-known/oauth-protected-resource/mcp`.
3. Register an OAuth client through the dashboard, or use dynamic registration
   if the client supports it.
4. Complete authorization code with PKCE and request `resource=<origin>/mcp`.
5. Send `initialize`.
6. Send `notifications/initialized`.
7. Call `tools/list`.
8. Call `resources/list` and `resources/read` for `openmemory://profile` or
   `openmemory://recent`.
9. Call `prompts/list` and `prompts/get` for `context`.
10. Call `tools/call` for `remember`, `recall`, `profile`, or `forget`.

## Known Gaps

- Manual external-client OAuth callback dogfooding remains recommended before a
  high-volume hosted launch. Its canonical status is
  `config/mcp-vendor-dogfood.json`; run `bun run mcp:vendor-dogfood:check` as
  the strict gate after updating MCP Inspector, Cursor, Claude, and ChatGPT
  evidence. Named streamable HTTP request shapes are smoke-tested in CI and the
  generic browser callback redirect/token-exchange path is covered by local and
  live browser E2E. Live browser E2E is the bearer-token proof; local browser
  E2E preserves localhost tenant-header routing after token exchange.
- MCP runs in the monolithic API Worker. Move to a dedicated `McpAgent` Worker
  only if session-specific state or independent scaling becomes necessary.
