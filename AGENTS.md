# AGENTS.md

- Use compound-engineering practices for non-trivial work:
  - read the relevant code and docs before editing
  - keep changes scoped to the roadmap/task
  - add or update tests for behavior changes
  - run the relevant local verification before committing
  - update roadmap/docs when implementation changes project status
- Use gitmoji in commit subjects.
  - Format: `<emoji> <imperative summary>`
  - Examples:
    - `✨ Add chunked source ingestion`
    - `✅ Expand local Wrangler integration coverage`
    - `🐛 Fix dashboard forget handling`
    - `📝 Document MCP client setup`
    - `🚀 Deploy Cloudflare Worker updates`
- Prefer small, coherent commits that map to one shipped behavior, test layer, doc update, or operational change.
- For Cloudflare work, prefer Wrangler and local Wrangler integration tests before live deployment.
- For browser-facing changes, run or update Playwright E2E coverage when practical.
