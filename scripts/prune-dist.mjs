import { readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const keep = new Set(["cli.cjs", "cli.cjs.map"]);

async function main() {
  const entries = await readdir(distDir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      if (keep.has(entry.name) || entry.name.endsWith(".node")) return;
      await rm(join(distDir, entry.name), { recursive: true, force: true });
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
