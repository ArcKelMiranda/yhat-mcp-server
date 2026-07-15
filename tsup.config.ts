import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["cjs"],
  platform: "node",
  outDir: "dist",
  target: "node20",
  noExternal: ["mssql", "js-yaml", "dotenv"],
  bundle: true,
  sourcemap: true,
  clean: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
