import { describe, it } from "node:test";
import { strictEqual } from "node:assert/strict";

import { resolveAuditLogDir } from "../src/paths.js";

describe("audit log path resolution", () => {
  it("resolves relative audit.logDir against the stable config root", () => {
    strictEqual(
      resolveAuditLogDir("logs", "/home/user/.local/share/yhat-mcp", "linux"),
      "/home/user/.local/share/yhat-mcp/logs",
    );
  });

  it("preserves absolute audit.logDir values", () => {
    strictEqual(resolveAuditLogDir("/var/log/yhat-mcp", "/home/user/.local/share/yhat-mcp", "linux"), "/var/log/yhat-mcp");
  });
});
