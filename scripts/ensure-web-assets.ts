import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(repoRoot, "apps/web/dist/client");
const indexPath = join(assetsDir, "index.html");

await mkdir(assetsDir, { recursive: true });

await writeFile(
  indexPath,
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenMemory</title>
</head>
<body>
  <p>Run <code>bun run dev:web</code> for the TanStack dashboard.</p>
</body>
</html>
`,
  { flag: "wx" },
).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== "EEXIST") {
    throw error;
  }
});
