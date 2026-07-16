# Changelog

All notable changes to OpenMemory will be documented here.

This project follows date-based alpha milestones until stable versioned
releases begin.

## Unreleased

- Prepare open-source launch scaffolding: license, contribution guide, security
  policy, support docs, issue templates, PR template, and launch checklist.

## 2026-07-16 Alpha

- Added Worker request IDs, structured request logs, JSON error envelopes, and
  rate-limit headers.
- Added configurable per-isolate rate limiting keyed by client IP and a
  non-secret credential fingerprint.
- Hardened manual Wrangler deploys with `--keep-vars`.
- Added operational-control unit tests and Worker integration coverage.
- Added MCP JSON-RPC tool-list smoke coverage.
- Verified production smoke for hosted UI, Better Auth session, graph recall,
  source ingestion, R2 export, OAuth PKCE, and MCP bearer tools.

## 2026-07-15 Alpha

- Polished the hosted dashboard direction with memory health metrics, charts,
  MCP setup, admin settings, and a library-backed knowledge graph explorer.
- Expanded local browser E2E coverage for dashboard, chart, table, ingest,
  graph, admin, and MCP setup panels.
- Confirmed Cloudflare Git/Workers Builds as the preferred production deploy
  path.

## 2026-07-08 Alpha

- Added Better Auth OAuth/OIDC discovery, dynamic client registration, JWKS,
  resource-token support, and MCP bearer authentication.
- Added OAuth/MCP connection listing and revocation.
- Added source ingestion, R2 exports, Vectorize repair, graph stats, recall
  benchmarking, and deterministic reranking coverage.
