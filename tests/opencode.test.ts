import { describe, it } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert/strict";

import { buildOpenCodeConfig, buildOpenCodeServerEntry } from "../src/opencode.js";

describe("OpenCode install config", () => {
  it("builds the portable local server entry", () => {
    deepStrictEqual(buildOpenCodeServerEntry(), {
      type: "local",
      command: ["yhat-mcp", "start"],
    });
  });

  it("does not include source paths or environment injection", () => {
    const config = buildOpenCodeConfig({ mcp: { existing: { type: "local", command: ["existing"] } } });

    strictEqual("workingDirectory" in (config.mcp?.["yhat-sql"] ?? {}), false);
    strictEqual("environment" in (config.mcp?.["yhat-sql"] ?? {}), false);
    deepStrictEqual(config.mcp?.["yhat-sql"], { type: "local", command: ["yhat-mcp", "start"] });
  });
});
