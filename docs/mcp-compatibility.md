# MCP Compatibility Matrix

OpenMemory exposes MCP over streamable HTTP at `/mcp` using Cloudflare Agents'
Worker-native `createMcpHandler`. Production clients authenticate with OAuth
bearer tokens. Local integration tests use the development tenant header path
so protocol behavior can run in CI without external OAuth fixtures.

Named client request profiles live in
[`config/mcp-client-profiles.json`](../config/mcp-client-profiles.json). The
root `bun run check` gate validates that profile artifact, required OAuth
scopes, expected tools, and this compatibility matrix stay in sync.

## Protocol Coverage

| Client behavior | Status | Evidence |
| --- | --- | --- |
| Streamable HTTP `POST /mcp` | Supported | `apps/api/test/http.integration.test.ts` posts JSON-RPC requests with `Accept: application/json, text/event-stream`. |
| OAuth protected resource discovery | Supported | Local and live tests validate `/.well-known/oauth-protected-resource/mcp`. |
| OAuth dynamic client registration | Supported | Local and live tests register Better Auth OAuth clients. |
| Authorization code with PKCE | Supported | Live E2E exchanges a PKCE code for an MCP-scoped bearer token. |
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
| MCP Inspector | Config-shape smoke in CI | `bun run test:mcp:sdk` runs an `mcp-inspector-config-shape` request profile with Inspector-like headers through the official transport. | Manual UI OAuth callback dogfooding remains useful before broad hosted launch. |
| Cursor | Config-shape smoke in CI | `bun run test:mcp:sdk` runs a `cursor-remote-mcp-config-shape` profile against `/mcp`. | Requires the user/client OAuth flow against the deployed Worker in real Cursor. |
| Claude remote MCP connector / Messages API MCP connector | Config-shape smoke in CI | `bun run test:mcp:sdk` runs a `claude-remote-mcp-config-shape` profile against `/mcp`. | Requires provider-side OAuth configuration in real Claude surfaces. |
| ChatGPT connector / Apps SDK MCP client | Config-shape smoke in CI | `bun run test:mcp:sdk` runs a `chatgpt-connector-mcp-config-shape` profile against `/mcp`. | Requires provider-side OAuth configuration in real ChatGPT connector surfaces. |

## Client Expectations

Generic MCP clients should use:

```txt
Transport: streamable-http
URL: https://openmemory-api.abbierman101.workers.dev/mcp
Accept: application/json, text/event-stream
Content-Type: application/json
Scopes: openid profile memory:read memory:write
```

The checked profile artifact can be used as a starting point for client-specific
configuration:

```sh
bun run mcp:profiles:check
```

Clients should run the normal MCP handshake:

1. Discover OAuth metadata from `/.well-known/oauth-authorization-server/api/auth`.
2. Discover protected-resource metadata from `/.well-known/oauth-protected-resource/mcp`.
3. Register an OAuth client if the client supports dynamic registration.
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
  high-volume hosted launch, but named Inspector, Cursor, Claude, and
  ChatGPT-style streamable HTTP request shapes are now smoke-tested in CI.
- MCP runs in the monolithic API Worker. Move to a dedicated `McpAgent` Worker
  only if session-specific state or independent scaling becomes necessary.
