import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const assetsDir = join("apps", "web", "dist", "client", "assets");
const maxChunkBytes = 500 * 1024;
const maxEntryBytes = 380 * 1024;

const files = await readdir(assetsDir);
const javascriptFiles = files.filter((file) => file.endsWith(".js")).sort();
const failures: string[] = [];

for (const file of javascriptFiles) {
  const size = (await stat(join(assetsDir, file))).size;
  const isEntryChunk = /^index-[\w-]+\.js$/.test(file);
  const limit = isEntryChunk ? maxEntryBytes : maxChunkBytes;

  if (size > limit) {
    failures.push(
      `${file}: ${formatBytes(size)} exceeds ${formatBytes(limit)}`,
    );
  }
}

if (failures.length > 0) {
  throw new Error(`Web bundle budget failed:\n${failures.join("\n")}`);
}

console.log(
  `Web bundle budget passed for ${javascriptFiles.length} JS chunks ` +
    `(entry <= ${formatBytes(maxEntryBytes)}, chunks <= ${formatBytes(maxChunkBytes)}).`,
);

function formatBytes(bytes: number) {
  return `${(bytes / 1024).toFixed(2)} kB`;
}
