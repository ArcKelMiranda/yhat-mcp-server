import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { match, ok, doesNotMatch } from "node:assert/strict";

describe("installer scripts", () => {
  it("bootstraps Node.js first on unix-like systems, then installs from GitHub Releases", () => {
    const script = readFileSync("install.sh", "utf8");

    match(script, /Node\.js is missing; bootstrapping Node\.js 20\+ via/);
    match(script, /apt-get update/);
    match(script, /deb\.nodesource\.com\/setup_20\.x/);
    match(script, /brew install node/);
    match(script, /python3 is required to parse GitHub release metadata/);
    match(script, /ensure_node_linux/);
    match(script, /ensure_node_macos/);
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
    doesNotMatch(script, /INSTALL_SOURCE_DIR|\$\(pwd\)|npm install && npm run build:cli|node -e 'const fs = require/);
  });

  it("bootstraps Node.js first on Windows, then installs from GitHub Releases", () => {
    const script = readFileSync("install.ps1", "utf8");

    match(script, /Install-NodeViaWinget/);
    match(script, /OpenJS\.NodeJS\.LTS/);
    match(script, /winget install -e --id OpenJS\.NodeJS\.LTS/);
    match(script, /Node\.js 20\+ is required/);
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
    doesNotMatch(script, /MyInvocation\.MyCommand\.Path|dist\\cli\.cjs not found|Node\.js is not installed\. Please install Node\.js 20\+/);
  });
});
