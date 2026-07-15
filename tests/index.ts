import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));

for (const entry of readdirSync(testsDir)) {
  if (entry.endsWith(".test.ts")) {
    await import(pathToFileURL(join(testsDir, entry)).href);
  }
}
