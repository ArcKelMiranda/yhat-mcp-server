import { afterEach, describe, it } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strictEqual } from "node:assert/strict";

import { prepareRuntimeEnvironment } from "../src/runtime.js";

const ORIGINAL_ENV = {
  YHAT_CONFIG_ROOT: process.env.YHAT_CONFIG_ROOT,
  FROM_STABLE: process.env.FROM_STABLE,
};

afterEach(() => {
  process.env.YHAT_CONFIG_ROOT = ORIGINAL_ENV.YHAT_CONFIG_ROOT;
  process.env.FROM_STABLE = ORIGINAL_ENV.FROM_STABLE;
});

describe("runtime env bootstrap", () => {
  it("loads stable env before runtime behavior runs", () => {
    const workspace = mkdtempSync(join(tmpdir(), "yhat-runtime-"));
    const stableRoot = join(workspace, "stable");
    mkdirSync(stableRoot, { recursive: true });
    writeFileSync(join(stableRoot, ".env"), "FROM_STABLE=loaded\n", "utf8");

    try {
      process.env.YHAT_CONFIG_ROOT = stableRoot;
      delete process.env.FROM_STABLE;

      prepareRuntimeEnvironment();

      strictEqual(process.env.FROM_STABLE, "loaded");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
