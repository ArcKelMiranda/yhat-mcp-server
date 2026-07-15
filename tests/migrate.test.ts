import { afterEach, describe, it } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deepStrictEqual, strictEqual, ok } from "node:assert/strict";

import { migrateStableConfig } from "../src/migrate.js";
import { KEYTAR_ACCOUNT, KEYTAR_SERVICE, type SecretStore } from "../src/keytar.js";
import { getDefaultConfigPath, getEnvPath } from "../src/paths.js";

const ORIGINAL_ENV = {
  YHAT_CONFIG_ROOT: process.env.YHAT_CONFIG_ROOT,
};

afterEach(() => {
  process.env.YHAT_CONFIG_ROOT = ORIGINAL_ENV.YHAT_CONFIG_ROOT;
});

function writeRepoFixtures(repoRoot: string): void {
  mkdirSync(join(repoRoot, "config"), { recursive: true });
  writeFileSync(
    join(repoRoot, "config", "yhat-mcp-config.yaml"),
    [
      "server:",
      "  name: yhat-mcp-server",
      "  transport: stdio",
      "database:",
      "  host: example.local",
      "  port: 1433",
      "  name: YHat",
      "  user: sa",
      "  passwordEnv: YHAT_DB_PASSWORD",
      "  encrypt: true",
      "whitelist:",
      "  - schema: dbo",
      "    tables:",
      "      - FACodes",
      "    mode: read_only",
      "limits:",
      "  maxRows: 1000",
      "  queryTimeoutSeconds: 30",
      "audit:",
      "  logDir: logs",
      "  maxSizeMb: 50",
      "  maxAgeDays: 30",
      "  logLevel: info",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(repoRoot, ".env"),
    [
      "YHAT_DB_HOST=repo.example.local",
      "YHAT_DB_PORT=8444",
      "YHAT_DB_NAME=YHat",
      "YHAT_DB_USER=sa",
      "YHAT_DB_PASSWORD=plain-text-secret",
      "",
    ].join("\n"),
    "utf8",
  );
}

function createSecretStore(): { store: SecretStore; calls: Array<{ service: string; account: string; password: string }> } {
  const calls: Array<{ service: string; account: string; password: string }> = [];

  return {
    calls,
    store: {
      getPassword: async () => null,
      setPassword: async (service: string, account: string, password: string) => {
        calls.push({ service, account, password });
      },
      deletePassword: async () => true,
    },
  };
}

describe("stable config migration", () => {
  it("copies repo config and env to the stable dir and strips the plaintext password", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "yhat-migrate-"));
    const repoRoot = join(workspace, "repo");
    const stableRoot = join(workspace, "stable");
    mkdirSync(repoRoot, { recursive: true });
    writeRepoFixtures(repoRoot);

    const { store, calls } = createSecretStore();
    process.env.YHAT_CONFIG_ROOT = stableRoot;

    try {
      await migrateStableConfig({ cwd: repoRoot, secretStore: store });

      const configPath = getDefaultConfigPath({ YHAT_CONFIG_ROOT: stableRoot });
      const envPath = getEnvPath({ YHAT_CONFIG_ROOT: stableRoot });

      ok(existsSync(configPath));
      ok(existsSync(envPath));
      ok(readFileSync(envPath, "utf8").includes("YHAT_DB_HOST=repo.example.local"));
      ok(!readFileSync(envPath, "utf8").includes("YHAT_DB_PASSWORD"));
      deepStrictEqual(calls, [
        { service: KEYTAR_SERVICE, account: KEYTAR_ACCOUNT, password: "plain-text-secret" },
      ]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("is idempotent when the stable files already exist", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "yhat-migrate-"));
    const repoRoot = join(workspace, "repo");
    const stableRoot = join(workspace, "stable");
    mkdirSync(repoRoot, { recursive: true });
    writeRepoFixtures(repoRoot);
    mkdirSync(join(stableRoot, "config"), { recursive: true });
    writeFileSync(join(stableRoot, "config", "yhat-mcp-config.yaml"), "existing: config\n", "utf8");
    writeFileSync(join(stableRoot, ".env"), "EXISTING=1\n", "utf8");

    const { store, calls } = createSecretStore();
    process.env.YHAT_CONFIG_ROOT = stableRoot;

    try {
      await migrateStableConfig({ cwd: repoRoot, secretStore: store });
      strictEqual(calls.length, 0);
      strictEqual(readFileSync(join(stableRoot, "config", "yhat-mcp-config.yaml"), "utf8"), "existing: config\n");
      strictEqual(readFileSync(join(stableRoot, ".env"), "utf8"), "EXISTING=1\n");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("keeps the database password in stable env when keychain save fails", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "yhat-migrate-"));
    const repoRoot = join(workspace, "repo");
    const stableRoot = join(workspace, "stable");
    mkdirSync(repoRoot, { recursive: true });
    writeRepoFixtures(repoRoot);

    const store: SecretStore = {
      getPassword: async () => null,
      setPassword: async () => {
        throw new Error("keychain unavailable");
      },
      deletePassword: async () => true,
    };
    process.env.YHAT_CONFIG_ROOT = stableRoot;

    try {
      await migrateStableConfig({ cwd: repoRoot, secretStore: store });

      const envPath = getEnvPath({ YHAT_CONFIG_ROOT: stableRoot });
      ok(readFileSync(envPath, "utf8").includes("YHAT_DB_PASSWORD=plain-text-secret"));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
