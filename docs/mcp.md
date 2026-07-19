# OpenMemory MCP

OpenMemory exposes a streamable HTTP MCP endpoint at:

```txt
https://openmemory-api.abbierman101.workers.dev/mcp
```

The MCP server uses OAuth-backed identity in production. Local development can use the tenant header flow for fast iteration, but deployed clients should use OAuth discovery plus either dashboard-managed public PKCE client registration or dynamic client registration.

Implementation note: OpenMemory currently serves MCP from the main API Worker using Cloudflare Agents' `createMcpHandler`. That is the Worker-native stateless MCP hosting path. Durable memory state is stored in OpenMemory Durable Objects, not in per-MCP-session Agent state. If we later need session-specific state or independent MCP scaling, move the endpoint to a dedicated Cloudflare Agents `McpAgent` Worker.

## Discovery

OAuth authorization server metadata:

```txt
https://openmemory-api.abbierman101.workers.dev/.well-known/oauth-authorization-server
```

The TanStack dashboard also shows the Better Auth issuer-scoped metadata URL
used by local and hosted clients:

```txt
https://openmemory-api.abbierman101.workers.dev/.well-known/oauth-authorization-server/api/auth
```

Protected resource metadata:

```txt
https://openmemory-api.abbierman101.workers.dev/.well-known/oauth-protected-resource/mcp
```

## Tools

- `remember`: stores a fact, preference, decision, episode, insight, or profile memory.
- `recall`: returns graph-aware context for a query.
- `profile`: returns stable and current profile context.
- `forget`: soft-forgets a memory by id.

## Resources

- `openmemory://profile`: stable and current profile context for the authenticated tenant.
- `openmemory://recent`: the most recent active memories for the authenticated tenant.

## Prompts

- `context`: returns profile plus relevant recall context for a client-provided task or question.

## Generic Client Config

Use this shape for MCP clients that support streamable HTTP plus OAuth:

```json
{
  "transport": "streamable-http",
  "url": "https://openmemory-api.abbierman101.workers.dev/mcp",
  "authorizationServer": "https://openmemory-api.abbierman101.workers.dev/.well-known/oauth-authorization-server/api/auth",
  "protectedResource": "https://openmemory-api.abbierman101.workers.dev/.well-known/oauth-protected-resource/mcp",
  "scopes": ["openid", "profile", "memory:read", "memory:write"]
}
```

Requests should include:

```txt
Accept: application/json, text/event-stream
Content-Type: application/json
```

## Local Development

Run the Worker locally:

```sh
bun run dev:api
```

For local-only calls, pass:

```txt
x-openmemory-user-id: local-user
```

Production rejects tenant headers by design. Use OAuth bearer tokens outside localhost.

## Connection Management

Authenticated users can create, inspect, and disable first-party public PKCE
OAuth clients:

```sh
curl -H "Cookie: better-auth.session_token=..." \
  https://openmemory-api.abbierman101.workers.dev/v1/oauth/clients

curl -X POST -H "Cookie: better-auth.session_token=..." \
  -H "Content-Type: application/json" \
  -d '{"name":"Cursor MCP","redirectUris":["http://127.0.0.1:39123/callback"]}' \
  https://openmemory-api.abbierman101.workers.dev/v1/oauth/clients

curl -X DELETE -H "Cookie: better-auth.session_token=..." \
  https://openmemory-api.abbierman101.workers.dev/v1/oauth/clients/<client-id>
```

Authenticated users can also inspect and revoke OAuth/MCP grants:

```sh
curl -H "Cookie: better-auth.session_token=..." \
  https://openmemory-api.abbierman101.workers.dev/v1/oauth/connections

curl -X DELETE -H "Cookie: better-auth.session_token=..." \
  https://openmemory-api.abbierman101.workers.dev/v1/oauth/connections/<client-id>
```

The TanStack app MCP panel shows the streamable HTTP URL, OAuth issuer,
authorization metadata URL, protected resource metadata URL, client
registration form, registered clients, connection list, and revoke actions.

See [MCP compatibility](mcp-compatibility.md) for the protocol matrix, tools,
resources, prompts, tested client request shapes, and known external-client
dogfooding gaps.

For a repeatable local named-client check, run:

```sh
bun run test:mcp:sdk
```

That starts local Wrangler and connects with the official MCP TypeScript SDK
`StreamableHTTPClientTransport`. The named request profiles are stored in
[`config/mcp-client-profiles.json`](../config/mcp-client-profiles.json) and
validated with:

```sh
bun run mcp:profiles:check
```
