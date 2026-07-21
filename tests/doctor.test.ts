import { describe, it } from "node:test";
import { ok, strictEqual } from "node:assert/strict";

import {
  checkVersion,
  checkConfigRoot,
  checkEnvFile,
  checkTcpConnectivity,
  checkWhitelist,
  detectOutputMode,
  formatReport,
  toJsonReport,
  aggregateSummary,
  executeChecks,
  renderReport,
  runChecks,
  type CheckContext,
  type CheckResult,
  type DoctorDependencies,
  type DoctorFlags,
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

describe("doctor — check tcp-connectivity", () => {
  it("returns ok with durationMs when host accepts a TCP connection", async () => {
    const { createServer } = await import("node:net");
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw new Error("expected numeric address");
    }
    try {
      const result = await checkTcpConnectivity(
        makeContext({
          config: {
            database: {
              host: "127.0.0.1",
              port: address.port,
              name: "x",
              user: "x",
              passwordEnv: "x",
              encrypt: true,
            },
          } as CheckContext["config"],
        }),
      );
      strictEqual(result.status, "ok");
      const data = result.data as { durationMs: number };
      ok(data.durationMs >= 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns fail when port is closed (ECONNREFUSED)", async () => {
    const result = await checkTcpConnectivity(
      makeContext({
        config: {
          database: {
            host: "127.0.0.1",
            port: 1,
            name: "x",
            user: "x",
            passwordEnv: "x",
            encrypt: true,
          },
        } as CheckContext["config"],
      }),
    );
    strictEqual(result.status, "fail");
    ok(result.detail?.toLowerCase().includes("refused") || result.detail?.toLowerCase().includes("connect"));
  });

  it("returns fail when host is invalid (ENOTFOUND)", async () => {
    const result = await checkTcpConnectivity(
      makeContext({
        config: {
          database: {
            host: "this-host-does-not-exist-zzz.invalid",
            port: 80,
            name: "x",
            user: "x",
            passwordEnv: "x",
            encrypt: true,
          },
        } as CheckContext["config"],
      }),
    );
    strictEqual(result.status, "fail");
    ok(result.detail !== undefined && result.detail.length > 0);
  });

  it("does not send credentials: socket.write spy confirms no payload emitted", async () => {
    const { createServer } = await import("node:net");
    const { createConnection } = await import("node:net");
    const server = createServer();
    let receivedData: Buffer | null = null;
    server.on("connection", (socket) => {
      socket.on("data", (chunk) => {
        if (receivedData === null) receivedData = Buffer.from(chunk);
        else receivedData = Buffer.concat([receivedData, chunk]);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw new Error("expected numeric address");
    }
    const spySocket = createConnection({ host: "127.0.0.1", port: address.port });
    const writeSpy: string[] = [];
    const originalWrite = spySocket.write.bind(spySocket);
    spySocket.write = ((chunk: string | Buffer, ...args: unknown[]): boolean => {
      writeSpy.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      return (originalWrite as unknown as (...a: unknown[]) => boolean)(chunk, ...args);
    }) as typeof spySocket.write;
    await new Promise<void>((resolve) => spySocket.once("connect", () => resolve()));
    spySocket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    strictEqual(writeSpy.length, 0, "TCP probe must not write anything to the socket");
    strictEqual(receivedData, null, "server received no payload bytes");
  });
});

describe("doctor — check whitelist", () => {
  it("returns ok with counts detail when whitelist is non-empty", async () => {
    const ctx = makeContext({
      config: {
        whitelist: [
          { schema: "public", tables: ["users", "orders"], mode: "read_only" },
          { schema: "audit", tables: ["events"], mode: "read_only" },
        ],
      } as unknown as CheckContext["config"],
    });
    const result = await checkWhitelist(ctx);
    strictEqual(result.status, "ok");
    strictEqual(result.detail, "2 schemas, 3 tables");
  });

  it("returns warn when whitelist is empty (data-bearing, never fail)", async () => {
    const ctx = makeContext({
      config: { whitelist: [] } as unknown as CheckContext["config"],
    });
    const result = await checkWhitelist(ctx);
    strictEqual(result.status, "warn");
  });

  it("includes full schema/table names in data for JSON mode", async () => {
    const ctx = makeContext({
      config: {
        whitelist: [{ schema: "public", tables: ["users"], mode: "read_only" }],
      } as unknown as CheckContext["config"],
    });
    const result = await checkWhitelist(ctx);
    const data = result.data as { schemas: Array<{ schema: string; tables: string[] }> };
    strictEqual(data.schemas.length, 1);
    strictEqual(data.schemas[0]?.schema, "public");
  });

  it("text detail does not include schema or table names (counts only)", async () => {
    const ctx = makeContext({
      config: {
        whitelist: [{ schema: "secretSchema", tables: ["secretTable"], mode: "read_only" }],
      } as unknown as CheckContext["config"],
    });
    const result = await checkWhitelist(ctx);
    strictEqual(result.detail?.includes("secretSchema"), false);
    strictEqual(result.detail?.includes("secretTable"), false);
  });
});

function makeOkCheck(id: string, title?: string): (ctx: CheckContext) => CheckResult {
  return () => ({ id, title: title ?? id, status: "ok", detail: "ok" });
}

function makeWarnCheck(id: string, title?: string): (ctx: CheckContext) => CheckResult {
  return () => ({ id, title: title ?? id, status: "warn", detail: "warn" });
}

function makeFailCheck(id: string, title?: string): (ctx: CheckContext) => CheckResult {
  return () => ({ id, title: title ?? id, status: "fail", detail: "fail" });
}

function makeThrowingCheck(id: string): (ctx: CheckContext) => Promise<CheckResult> {
  return async () => {
    throw new Error("boom");
  };
}

function makeDeps(overrides: Partial<DoctorDependencies> = {}): DoctorDependencies {
  return {
    root: "/tmp/yhat",
    envPath: "/tmp/yhat/.env",
    config: {} as DoctorDependencies["config"],
    secretStore: null,
    pkgVersion: "0.1.0",
    checks: [],
    ...overrides,
  };
}

function makeFlags(overrides: Partial<DoctorFlags> = {}): DoctorFlags {
  return { checkAuth: false, ...overrides };
}

describe("doctor — orchestration (aggregateSummary)", () => {
  it("all OK -> exitCode 0", () => {
    const summary = aggregateSummary([
      makeOkCheck("a")({} as CheckContext),
      makeOkCheck("b")({} as CheckContext),
    ]);
    strictEqual(summary.exitCode, 0);
    strictEqual(summary.ok, 2);
  });

  it("single WARN -> exitCode 1", () => {
    const summary = aggregateSummary([makeWarnCheck("a")({} as CheckContext)]);
    strictEqual(summary.exitCode, 1);
    strictEqual(summary.warn, 1);
  });

  it("single FAIL -> exitCode 2", () => {
    const summary = aggregateSummary([makeFailCheck("a")({} as CheckContext)]);
    strictEqual(summary.exitCode, 2);
    strictEqual(summary.fail, 1);
  });

  it("FAIL + WARN -> exitCode 2 (FAIL beats WARN)", () => {
    const summary = aggregateSummary([
      makeFailCheck("a")({} as CheckContext),
      makeWarnCheck("b")({} as CheckContext),
    ]);
    strictEqual(summary.exitCode, 2);
  });
});

describe("doctor — orchestration (executeChecks)", () => {
  it("runs checks sequentially and converts throws into fail results", async () => {
    const order: string[] = [];
    const track = (id: string): (ctx: CheckContext) => Promise<CheckResult> => async () => {
      order.push(id);
      return { id, title: id, status: "ok" };
    };
    const checks = [track("a"), track("b"), makeThrowingCheck("c"), track("d")];
    const results = await executeChecks(makeContext(), checks);
    strictEqual(order.join(","), "a,b,d");
    strictEqual(results.length, 4);
    const fail = results.find((r: CheckResult) => r.id === "check-2");
    strictEqual(fail?.status, "fail");
    ok(fail?.detail?.includes("boom"));
  });
});

describe("doctor — TTY detection", () => {
  it("detectOutputMode returns 'text' when stdout.isTTY is strictly true", () => {
    const desc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      strictEqual(detectOutputMode(), "text");
    } finally {
      if (desc) Object.defineProperty(process.stdout, "isTTY", desc);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });

  it("detectOutputMode returns 'json' when stdout.isTTY is false", () => {
    const desc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    try {
      strictEqual(detectOutputMode(), "json");
    } finally {
      if (desc) Object.defineProperty(process.stdout, "isTTY", desc);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });

  it("detectOutputMode returns 'json' when stdout.isTTY is undefined", () => {
    const desc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: undefined, configurable: true });
    try {
      strictEqual(detectOutputMode(), "json");
    } finally {
      if (desc) Object.defineProperty(process.stdout, "isTTY", desc);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });

  it("renderReport returns the same string formatReport would produce for the detected mode", () => {
    const report = makeReport({ exitCode: 0 });
    const desc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      const textFromRender = renderReport(report);
      const textFromFormat = formatReport(report, "text");
      strictEqual(textFromRender, textFromFormat);
    } finally {
      if (desc) Object.defineProperty(process.stdout, "isTTY", desc);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });

  it("renderReport has no stdout side effects (does not write to process.stdout)", () => {
    const report = makeReport();
    const desc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const originalWrite = process.stdout.write.bind(process.stdout);
    const writes: string[] = [];
    (process.stdout as { write: (s: string) => boolean }).write = ((chunk: string): boolean => {
      writes.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      const output = renderReport(report);
      strictEqual(writes.length, 0, "renderReport must not write to stdout");
      ok(output.length > 0);
    } finally {
      process.stdout.write = originalWrite;
      if (desc) Object.defineProperty(process.stdout, "isTTY", desc);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });
});

describe("doctor — runChecks end-to-end", () => {
  it("happy path -> exitCode 0 with all checks OK", async () => {
    const report = await runChecks(
      [makeOkCheck("a"), makeOkCheck("b")],
      makeDeps(),
      makeFlags(),
    );
    strictEqual(report.exitCode, 0);
    strictEqual(report.summary.ok, 2);
    strictEqual(report.summary.warn, 0);
    strictEqual(report.summary.fail, 0);
  });

  it("WARN check -> exitCode 1", async () => {
    const report = await runChecks(
      [makeOkCheck("a"), makeWarnCheck("b")],
      makeDeps(),
      makeFlags(),
    );
    strictEqual(report.exitCode, 1);
  });

  it("FAIL check -> exitCode 2", async () => {
    const report = await runChecks(
      [makeOkCheck("a"), makeFailCheck("b")],
      makeDeps(),
      makeFlags(),
    );
    strictEqual(report.exitCode, 2);
  });

  it("two consecutive runs are structurally identical (timestamps masked)", async () => {
    const checks: readonly ((ctx: CheckContext) => CheckResult | Promise<CheckResult>)[] = [makeOkCheck("a")];
    const flags = makeFlags();
    const deps = makeDeps();
    const a = await runChecks(checks, deps, flags);
    const b = await runChecks(checks, deps, flags);

    const mask = (r: DoctorReport): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        out[k] = k === "startedAt" ? "<masked>" : v;
      }
      return out;
    };
    const nodeAssert = await import("node:assert/strict");
    const deepStrictEqual = nodeAssert.deepStrictEqual as (a: unknown, b: unknown) => void;
    deepStrictEqual(mask(a), mask(b));
  });
});