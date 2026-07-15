import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const testsDir = new URL("../tests/", import.meta.url);

async function main() {
  const hits = [];
  await scan(testsDir, hits);

  if (hits.length > 0) {
    console.error("Found forbidden test.only / .only usage:");
    for (const hit of hits) console.error(`- ${hit}`);
    process.exitCode = 1;
  }
}

async function scan(dir, hits) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryUrl = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) {
      await scan(entryUrl, hits);
      continue;
    }

    if (!entry.name.endsWith(".ts")) continue;
    const content = await readFile(entryUrl, "utf8");
    if (/\b(?:test|it|describe)\.only\s*\(/.test(content)) {
      hits.push(join("tests", entry.name));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
