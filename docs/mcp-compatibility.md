# MCP Compatibility Matrix

OpenMemory exposes MCP over streamable HTTP at `/mcp` using Cloudflare Agents'
Worker-native `createMcpHandler`. Production clients authenticate with OAuth
bearer tokens. Local integration tests use the development tenant header path
so protocol behavior can run in CI without external OAuth fixtures.

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
| `resources/list` | Not exposed | Integration tests verify the server returns a valid JSON-RPC response for optional resource discovery. |
| `prompts/list` | Not exposed | Integration tests verify the server returns a valid JSON-RPC response for optional prompt discovery. |
| Server-sent streaming tool results | Not required today | Tools return JSON responses. Streaming can be added later for long-running ingest or recall. |

## Named Client Dogfooding

| Client | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Official MCP TypeScript SDK `StreamableHTTPClientTransport` | Tested in CI | `bun run test:mcp:sdk` starts local Wrangler, connects to `/mcp`, lists tools, calls `remember`, and calls `recall`. | Uses the local tenant header because CI cannot complete browser OAuth. Production clients should use OAuth. |
| MCP Inspector | Config-ready | Use the streamable HTTP URL and headers below. | Manual UI dogfooding remains useful before broad launch because Inspector OAuth and browser callback handling are interactive. |
| Cursor | Config-ready | Generic streamable HTTP config below. | Requires the user/client OAuth flow against the deployed Worker. |
| Claude remote MCP connector / Messages API MCP connector | Config-ready | Generic streamable HTTP config below. | Requires provider-side OAuth configuration and is not suitable for unattended CI. |

## Client Expectations

Generic MCP clients should use:

```txt
Transport: streamable-http
URL: https://openmemory-api.abbierman101.workers.dev/mcp
Accept: application/json, text/event-stream
Content-Type: application/json
Scopes: openid profile memory:read memory:write
```

Clients should run the normal MCP handshake:

1. Discover OAuth metadata from `/.well-known/oauth-authorization-server/api/auth`.
2. Discover protected-resource metadata from `/.well-known/oauth-protected-resource/mcp`.
3. Register an OAuth client if the client supports dynamic registration.
4. Complete authorization code with PKCE and request `resource=<origin>/mcp`.
5. Send `initialize`.
6. Send `notifications/initialized`.
7. Call `tools/list`.
8. Call `tools/call` for `remember`, `recall`, `profile`, or `forget`.

## Known Gaps

- Dedicated manual external-client dogfooding remains before a broad public
  launch for interactive clients such as MCP Inspector, Cursor, Claude, and
  ChatGPT connector flows.
- OpenMemory does not currently expose MCP resources or prompts.
- MCP runs in the monolithic API Worker. Move to a dedicated `McpAgent` Worker
  only if session-specific state or independent scaling becomes necessary.
