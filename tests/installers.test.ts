import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { strictEqual, match, ok } from "node:assert/strict";

describe("installer scripts", () => {
  it("copies dist/cli.cjs and keytar bindings on unix-like systems", () => {
    const script = readFileSync("install.sh", "utf8");

    match(script, /dist\/cli\.cjs/);
    match(script, /XDG_DATA_HOME:-\$HOME\/\.local\/share/);
    match(script, /APP_DIR=.*yhat-mcp/);
    match(script, /BIN_DIR="\$\{HOME\}\/\.local\/bin"/);
    match(script, /\$\{BIN_DIR\}\/\$\{BIN_NAME\}/);
    match(script, /keytar/);
  });

  it("copies dist/cli.cjs and keytar bindings on Windows", () => {
    const script = readFileSync("install.ps1", "utf8");

    match(script, /dist\\cli\.cjs/);
    match(script, /LOCALAPPDATA\\yhat-mcp/);
    match(script, /yhat-mcp\.cmd/);
    match(script, /keytar/);
    ok(script.includes("Path"));
  });
});
