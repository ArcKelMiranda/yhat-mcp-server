import { afterEach, describe, it } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import { tmpdir } from "node:os";
import { strictEqual, ok } from "node:assert/strict";

import { getConfigRoot, resolveConfigPath } from "../src/paths.js";
import { loadEnv } from "../src/env.js";

const ORIGINAL_CWD = process.cwd();

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  delete process.env.YHAT_CONFIG_ROOT;
  delete process.env.YHAT_CONFIG_PATH;
  delete process.env.FROM_STABLE;
  delete process.env.FROM_CWD;
  delete process.env.PREEXISTING;
});

describe("config path helpers", () => {
  it("uses explicit config root and config path overrides", () => {
    const env = {
      YHAT_CONFIG_ROOT: "D:\\yhat\\data",
      YHAT_CONFIG_PATH: "D:\\custom\\yhat-mcp-config.yaml",
    } satisfies NodeJS.ProcessEnv;

    strictEqual(getConfigRoot(env, "win32", "C:\\Users\\Kelvin"), win32.normalize("D:\\yhat\\data"));
    strictEqual(resolveConfigPath(env, "win32", "C:\\Users\\Kelvin"), win32.normalize("D:\\custom\\yhat-mcp-config.yaml"));
  });

  it("resolves unix-like paths from XDG_DATA_HOME", () => {
    const env = {
      XDG_DATA_HOME: "/home/alice/.local/share",
    } satisfies NodeJS.ProcessEnv;

    strictEqual(getConfigRoot(env, "linux", "/home/alice"), posix.join("/home/alice/.local/share", "yhat-mcp"));
    strictEqual(
      resolveConfigPath(env, "linux", "/home/alice"),
      posix.join("/home/alice/.local/share", "yhat-mcp", "config", "yhat-mcp-config.yaml"),
    );
  });

  it("falls back to LOCALAPPDATA on Windows", () => {
    const env = {
      LOCALAPPDATA: "C:\\Users\\Kelvin\\AppData\\Local",
    } satisfies NodeJS.ProcessEnv;

    strictEqual(getConfigRoot(env, "win32", "C:\\Users\\Kelvin"), win32.join("C:\\Users\\Kelvin\\AppData\\Local", "yhat-mcp"));
  });
});

describe("stable env loading", () => {
  it("loads .env from the stable config root and ignores cwd .env", () => {
    const workspace = mkdtempSync(join(tmpdir(), "yhat-paths-"));
    const stableRoot = join(workspace, "stable");
    const cwdRoot = join(workspace, "cwd");

    mkdirSync(join(stableRoot, "config"), { recursive: true });
    mkdirSync(cwdRoot, { recursive: true });

    writeFileSync(
      join(stableRoot, ".env"),
      "FROM_STABLE=right\nYHAT_DB_HOST=stable-host.example\nPREEXISTING=from-file\n",
      "utf8",
    );
    writeFileSync(join(cwdRoot, ".env"), "FROM_CWD=wrong\n", "utf8");

    const previousEnv = {
      YHAT_CONFIG_ROOT: process.env.YHAT_CONFIG_ROOT,
      FROM_STABLE: process.env.FROM_STABLE,
      FROM_CWD: process.env.FROM_CWD,
      PREEXISTING: process.env.PREEXISTING,
    };

    try {
      process.chdir(cwdRoot);
      setEnv({
        YHAT_CONFIG_ROOT: stableRoot,
        FROM_STABLE: undefined,
        FROM_CWD: undefined,
        YHAT_DB_HOST: "127.0.0.1",
        PREEXISTING: "keep-me",
      });

      loadEnv();

      strictEqual(process.env.FROM_STABLE, "right");
      strictEqual(process.env.YHAT_DB_HOST, "stable-host.example");
      strictEqual(process.env.FROM_CWD, undefined);
      strictEqual(process.env.PREEXISTING, "keep-me");
      ok(!readFileSync(join(cwdRoot, ".env"), "utf8").includes("FROM_STABLE"));
    } finally {
      process.chdir(ORIGINAL_CWD);
      setEnv(previousEnv);
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("keeps existing process.env values when override is false", () => {
    const workspace = mkdtempSync(join(tmpdir(), "yhat-paths-"));
    const stableRoot = join(workspace, "stable");

    mkdirSync(join(stableRoot, "config"), { recursive: true });
    writeFileSync(join(stableRoot, ".env"), "PREEXISTING=from-file\n", "utf8");

    try {
      setEnv({
        YHAT_CONFIG_ROOT: stableRoot,
        PREEXISTING: "keep-me",
      });

      loadEnv();

      strictEqual(process.env.PREEXISTING, "keep-me");
    } finally {
      process.chdir(ORIGINAL_CWD);
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
