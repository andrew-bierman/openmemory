# Security Policy

OpenMemory is alpha software, but security reports are taken seriously because
the system stores personal memory, OAuth grants, and graph context.

## Supported Versions

Security fixes target the current `main` branch until tagged releases exist.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability.

Report privately through GitHub Security Advisories for this repository. Include:

- Affected route, package, or deployment surface.
- Reproduction steps or proof of concept.
- Impact assessment, including whether tenant data, OAuth tokens, exports, or
  Durable Object state can be accessed or modified.
- Any logs, request IDs, or Cloudflare ray IDs that help trace the issue.

If GitHub Security Advisories are unavailable, contact the repository owner
privately through GitHub and request a secure reporting channel.

## Security-Sensitive Areas

- OAuth/OIDC discovery, dynamic client registration, token issuance, JWKS, and
  bearer-token verification.
- Better Auth session handling and D1 auth storage.
- Tenant resolution and rejection of production tenant headers.
- Durable Object graph isolation.
- R2 export generation and access.
- MCP tool authorization and streamable HTTP transport.
- Rate limiting, request logging, and operational controls.

Operational rollback, alerting, WAF/rate-limit recommendations, and alpha data
retention guidance live in [docs/operations.md](docs/operations.md).

## Disclosure

We aim to acknowledge valid reports quickly, fix high-impact issues before
public disclosure, and credit reporters when requested.
