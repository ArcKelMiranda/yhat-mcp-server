import { describe, it } from "node:test";
import { ok, strictEqual } from "node:assert/strict";

import { formatReport, toJsonReport, type CheckResult, type DoctorReport } from "../src/doctor.js";

function makeReport(overrides: Partial<DoctorReport> = {}): DoctorReport {
  const checks: readonly CheckResult[] = [
    { id: "version", title: "version", status: "ok", detail: "yhat-mcp-server 0.1.0" },
  ];
  return {
    version: "0.1.0",
    node: "v22.0.0",
    platform: "linux",
    arch: "x64",
    startedAt: "2026-07-21T00:00:00.000Z",
    checks,
    summary: { ok: 1, warn: 0, fail: 0 },
    exitCode: 0,
    ...overrides,
  };
}

describe("doctor — output rendering", () => {
  it("formatReport('text') returns a 78-col table with header and footer", () => {
    const out = formatReport(makeReport({ exitCode: 2 }), "text");
    ok(out.includes("CHECK"));
    ok(out.includes("STATUS"));
    ok(out.includes("DETAIL"));
    ok(out.includes("exit 2"));
    ok(out.includes("Summary:"));
  });

  it("formatReport('text') does NOT include schema/table names from whitelist detail", () => {
    const report = makeReport({
      checks: [
        {
          id: "whitelist",
          title: "whitelist",
          status: "ok",
          detail: "2 schemas, 7 tables",
          data: {
            schemas: [
              { schema: "secretSchema", tables: ["secretTable1", "secretTable2"] },
              { schema: "public", tables: ["users"] },
            ],
          },
        },
      ],
    });
    const out = formatReport(report, "text");
    ok(!out.includes("secretSchema"));
    ok(!out.includes("secretTable1"));
    ok(out.includes("2 schemas, 7 tables"));
  });

  it("formatReport('text') footer echoes the report's exitCode exactly", () => {
    const out = formatReport(makeReport({ exitCode: 1 }), "text");
    ok(out.includes("exit 1"));
  });

  it("toJsonReport returns a single-line JSON string parseable by JSON.parse", () => {
    const json = toJsonReport(makeReport());
    ok(!json.includes("\n"), "must be a single line");
    const parsed = JSON.parse(json) as DoctorReport;
    strictEqual(parsed.exitCode, 0);
    strictEqual(parsed.checks.length, 1);
  });

  it("toJsonReport never emits CR (0x0D) bytes regardless of os.EOL", () => {
    // Spec guarantee: JSON output uses LF only, no CR, even on Windows.
    // We can't redefine os.EOL (it's non-configurable in Node), so we
    // assert the contract directly: the output must contain no \r bytes.
    const json = toJsonReport(makeReport());
    ok(!json.includes("\r"), `found CR byte in: ${JSON.stringify(json)}`);
  });

it("toJsonReport redacts secrets referenced by sensitive keys", () => {
    const report = makeReport({
      checks: [
        {
          id: "auth-roundtrip",
          title: "auth-roundtrip",
          status: "fail",
          detail: "auth failed: Login failed for user 'sa' (password=supersecret123)",
          data: { error: "Login failed for user 'sa' (password=supersecret123)" },
        },
      ],
    });
    const json = toJsonReport(report);
    ok(!json.includes("supersecret123"), `leaked secret: ${json}`);
    ok(json.includes("[REDACTED]"), "expected redaction marker");
  });

it("formatReport('text') redacts secrets referenced by sensitive keys", () => {
    const report = makeReport({
      checks: [
        {
          id: "auth-roundtrip",
          title: "auth-roundtrip",
          status: "fail",
          detail: "auth failed: Login failed for user 'sa' (password=supersecret123)",
          data: { error: "Login failed for user 'sa' (password=supersecret123)" },
        },
      ],
    });
    const out = formatReport(report, "text");
    ok(!out.includes("supersecret123"));
    ok(out.includes("[REDACTED]"));
  });
});