import { existsSync } from "node:fs";

// Cloudflare Workers Builds reads a repo-root .tool-versions file and fails
// provisioning the build environment from it (observed 2026-11-20: the hosted
// build went red on every branch for weeks with no local signal). Tool pins
// live in mise.toml, which the build system ignores.
if (existsSync(".tool-versions")) {
  console.error(
    ".tool-versions exists at the repo root. Cloudflare Workers Builds reads it and fails provisioning the build environment — keep tool pins in mise.toml and do not commit a .tool-versions file.",
  );
  process.exit(1);
}
console.log("No .tool-versions at repo root.");
