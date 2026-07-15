import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["cjs"],
  platform: "node",
  outDir: "dist",
  target: "node20",
  noExternal: ["@modelcontextprotocol/server", "mssql", "js-yaml", "dotenv", "zod", "node-sql-parser"],
  bundle: true,
  sourcemap: true,
  clean: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
