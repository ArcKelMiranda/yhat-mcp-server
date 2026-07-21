import { describe, it } from "node:test";
import { ok, strictEqual } from "node:assert/strict";

import {
  checkVersion,
  checkConfigRoot,
  checkEnvFile,
  formatReport,
  toJsonReport,
  type CheckContext,
  type CheckResult,
  type DoctorReport,
} from "../src/doctor.js";

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

function makeContext(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    root: "/tmp/yhat",
    envPath: "/tmp/yhat/.env",
    config: {} as CheckContext["config"],
    secretStore: null,
    flags: { checkAuth: false },
    pkgVersion: "0.1.0",
    ...overrides,
  };
}

describe("doctor — check version", () => {
  it("returns ok with pkg, node, platform, arch in data", async () => {
    const result = await checkVersion(makeContext());
    strictEqual(result.id, "version");
    strictEqual(result.status, "ok");
    const data = result.data as { pkg: string; node: string; platform: string; arch: string };
    strictEqual(data.pkg, "yhat-mcp-server");
    ok(typeof data.node === "string" && data.node.startsWith("v"));
    strictEqual(data.platform, process.platform);
    strictEqual(data.arch, process.arch);
  });
});

describe("doctor — check config-root", () => {
  it("returns ok when root exists and is writable", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const workspace = mkdtempSync(join(tmpdir(), "yhat-doctor-cfgroot-"));
    try {
      const result = await checkConfigRoot(makeContext({ root: workspace }));
      strictEqual(result.status, "ok");
      ok(result.detail === workspace || result.detail === workspace.replace(/\\/g, "/"));
    } finally {
      const { rmSync } = await import("node:fs");
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("returns fail when root does not exist", async () => {
    const result = await checkConfigRoot(makeContext({ root: "/nonexistent/yhat-root-xyz" }));
    strictEqual(result.status, "fail");
    ok(result.detail?.includes("not found"));
  });
});

describe("doctor — check env-file", () => {
  it("returns ok when all required YHAT_DB_* keys are present and masks the password", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const workspace = mkdtempSync(join(tmpdir(), "yhat-doctor-env-"));
    const envPath = join(workspace, ".env");
    writeFileSync(
      envPath,
      "YHAT_DB_HOST=db.example\nYHAT_DB_PORT=1433\nYHAT_DB_NAME=mydb\nYHAT_DB_USER=sa\nYHAT_DB_PASSWORD=supersecret123\n",
      "utf8",
    );
    try {
      const result = await checkEnvFile(makeContext({ envPath }));
      strictEqual(result.status, "ok");
      ok(result.detail?.includes("YHAT_DB_HOST"));
      ok(!result.detail?.includes("supersecret123"), "password value must NOT appear in detail");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("returns warn when a required key is missing", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const workspace = mkdtempSync(join(tmpdir(), "yhat-doctor-env-"));
    const envPath = join(workspace, ".env");
    writeFileSync(envPath, "YHAT_DB_HOST=db.example\n", "utf8");
    try {
      const result = await checkEnvFile(makeContext({ envPath }));
      strictEqual(result.status, "warn");
      ok(result.detail?.includes("missing"));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});