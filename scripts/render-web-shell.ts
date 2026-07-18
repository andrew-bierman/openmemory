import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const webServerPath = join(repoRoot, "apps/web/dist/server/server.js");
const webShellPath = join(repoRoot, "apps/web/dist/client/index.html");

type WebServer = {
  fetch(request: Request): Promise<Response>;
};

const webServerModule = (await import(pathToFileURL(webServerPath).href)) as {
  default: WebServer;
};

const response = await webServerModule.default.fetch(
  new Request("https://openmemory.local/?view=recall", {
    headers: { accept: "text/html" },
  }),
);

if (!response.ok) {
  throw new Error(
    `Could not render TanStack web shell: ${response.status} ${response.statusText}`,
  );
}

const html = await response.text();

for (const expected of [
  "Memory Dashboard",
  "/assets/",
  "OpenMemory",
  "Operations",
]) {
  if (!html.includes(expected)) {
    throw new Error(
      `Rendered TanStack web shell is missing expected content: ${expected}`,
    );
  }
}

await mkdir(dirname(webShellPath), { recursive: true });
await writeFile(webShellPath, `${html}\n`);

console.log(`Rendered TanStack web shell to ${webShellPath}`);
