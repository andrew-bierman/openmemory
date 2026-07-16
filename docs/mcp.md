# OpenMemory MCP

OpenMemory exposes a streamable HTTP MCP endpoint at:

```txt
https://openmemory-api.abbierman101.workers.dev/mcp
```

The MCP server uses OAuth-backed identity in production. Local development can use the tenant header flow for fast iteration, but deployed clients should use OAuth discovery and dynamic client registration.

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

Authenticated users can inspect and revoke OAuth/MCP connections:

```sh
curl -H "Cookie: better-auth.session_token=..." \
  https://openmemory-api.abbierman101.workers.dev/v1/oauth/connections

curl -X DELETE -H "Cookie: better-auth.session_token=..." \
  https://openmemory-api.abbierman101.workers.dev/v1/oauth/connections/<client-id>
```

The TanStack app MCP panel shows the streamable HTTP URL, OAuth issuer,
authorization metadata URL, protected resource metadata URL, and the same
connection list and revoke actions.

See [MCP compatibility](mcp-compatibility.md) for the protocol matrix, tested
client request shapes, and known external-client dogfooding gaps.
