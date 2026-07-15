import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { match, ok, doesNotMatch } from "node:assert/strict";

describe("installer scripts", () => {
  it("bootstraps from GitHub Releases on unix-like systems", () => {
    const script = readFileSync("install.sh", "utf8");

    match(script, /releases\/latest/);
    match(script, /releases\/tags\/\$\{RELEASE_TAG\}/);
    match(script, /tarball_url/);
    match(script, /mktemp -d/);
    match(script, /npm ci/);
    match(script, /npm run build:cli/);
    match(script, /APP_DIR=.*yhat-mcp/);
    match(script, /BIN_DIR="\$\{HOME\}\/\.local\/bin"/);
    match(script, /\$\{BIN_DIR\}\/\$\{BIN_NAME\}/);
    match(script, /keytar/);
    doesNotMatch(script, /INSTALL_SOURCE_DIR|\$\(pwd\)|npm install && npm run build:cli/);
  });

  it("bootstraps from GitHub Releases on Windows", () => {
    const script = readFileSync("install.ps1", "utf8");

    match(script, /releases\/latest/);
    match(script, /releases\/tags\/\$ReleaseTag/);
    match(script, /zipball_url/);
    match(script, /Expand-Archive/);
    match(script, /Invoke-WebRequest/);
    match(script, /npm ci/);
    match(script, /npm run build:cli/);
    match(script, /LOCALAPPDATA\\yhat-mcp/);
    match(script, /yhat-mcp\.cmd/);
    match(script, /keytar/);
    ok(script.includes("Path"));
    ok(script.includes("ReleaseTag"));
    doesNotMatch(script, /MyInvocation\.MyCommand\.Path|dist\\cli\.cjs not found/);
  });
});
