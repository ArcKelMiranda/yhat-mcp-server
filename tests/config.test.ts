import { describe, it } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strictEqual } from "node:assert/strict";

import { loadConfigFile } from "../src/config.js";

function buildConfigYaml(portValue: string): string {
  const portLine = portValue.includes("$") ? `  port: \"${portValue}\"` : `  port: ${portValue}`;

  return `server:\n  name: yhat-mcp-server\n  transport: stdio\ndatabase:\n  host: example.local\n${portLine}\n  name: YHat\n  user: sa\n  passwordEnv: YHAT_DB_PASSWORD\n  encrypt: true\nwhitelist:\n  - schema: dbo\n    tables:\n      - FACodes\n    mode: read_only\nlimits:\n  maxRows: 1000\n  queryTimeoutSeconds: 30\naudit:\n  logDir: logs\n  maxSizeMb: 50\n  maxAgeDays: 30\n  logLevel: info\n`;
}

describe("config loading", () => {
  it("coerces an interpolated database.port to a number", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "yhat-config-"));
    const configPath = join(workspace, "yhat-mcp-config.yaml");

    writeFileSync(configPath, buildConfigYaml("${YHAT_DB_PORT}"), "utf8");

    try {
      const config = await loadConfigFile(configPath, { YHAT_DB_PORT: "1433", YHAT_DB_PASSWORD: "secret" });

      strictEqual(config.database.port, 1433);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("coerces a plain string database.port to a number", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "yhat-config-"));
    const configPath = join(workspace, "yhat-mcp-config.yaml");

    writeFileSync(configPath, buildConfigYaml("1434"), "utf8");

    try {
      const config = await loadConfigFile(configPath, { YHAT_DB_PASSWORD: "secret" });

      strictEqual(config.database.port, 1434);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
