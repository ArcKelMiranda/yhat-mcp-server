import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strictEqual, ok, deepStrictEqual } from "node:assert/strict";

import tsupConfig from "../tsup.config.ts";

describe("package metadata", () => {
  it("ships the dist bundle and points bin to dist/cli.cjs", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      bin: Record<string, string>;
      files?: string[];
    };

    strictEqual(pkg.bin["yhat-mcp"], "./dist/cli.cjs");
    ok(pkg.files?.includes("dist") ?? false);
  });

  it("bundles the MCP server runtime and keeps keytar external", () => {
    const config = tsupConfig as {
      entry: string[];
      noExternal?: string[];
    };

    deepStrictEqual(config.entry, ["src/cli.ts"]);
    ok(Array.isArray(config.noExternal));
    ok(config.noExternal?.includes("@modelcontextprotocol/server") ?? false);
    ok(config.noExternal?.includes("dotenv") ?? false);
    ok(config.noExternal?.includes("zod") ?? false);
    ok(!(config.noExternal?.includes("keytar") ?? false));
  });
});
