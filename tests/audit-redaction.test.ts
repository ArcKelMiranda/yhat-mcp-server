import { afterEach, describe, it } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ok } from "node:assert/strict";

import { createAuditLogger } from "../src/audit.js";

describe("audit SQL redaction", () => {
  const workspaces: string[] = [];

  afterEach(() => {
    while (workspaces.length > 0) {
      rmSync(workspaces.pop()!, { recursive: true, force: true });
    }
  });

  it("redacts SQL literals before writing audit logs", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "yhat-audit-"));
    workspaces.push(workspace);

    const logger = createAuditLogger({
      logDir: workspace,
      maxSizeMb: 50,
      maxAgeDays: 30,
      logLevel: "info",
    });

    await logger.log({
      timestamp: new Date().toISOString(),
      userIdentity: "tester",
      queryText: "select * from users where email = 'foo@example.com' and id = 1234 -- secret",
      tables: ["dbo.users"],
      status: "ALLOWED",
      rowsReturned: 1,
      durationMs: 10,
    });

    const fileName = readdirSync(workspace).find((name) => name.startsWith("audit-") && name.endsWith(".ndjson"));
    ok(fileName !== undefined);

    const files = readFileSync(join(workspace, fileName!), "utf8");
    ok(!files.includes("foo@example.com"));
    ok(!files.includes("1234"));
    ok(files.includes("'?'"));
  });
});
