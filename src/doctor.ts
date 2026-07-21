import { access, constants, readFile, readdir, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import sql from "mssql";

import { resolveAuditLogDir } from "./paths.js";
import { KEYTAR_ACCOUNT, loadSecret, type SecretStore } from "./keytar.js";
import type { Config } from "./types.js";

export type CheckStatus = "ok" | "warn" | "fail";

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  detail?: string;
  data?: unknown;
}

export interface CheckContext {
  root: string;
  envPath: string;
  config: Config;
  secretStore: SecretStore | null;
  flags: { checkAuth: boolean };
  pkgVersion: string;
}

export type Check = (ctx: CheckContext) => Promise<CheckResult> | CheckResult;

export interface DoctorReport {
  version: string;
  node: string;
  platform: NodeJS.Platform;
  arch: string;
  startedAt: string;
  checks: readonly CheckResult[];
  summary: { ok: number; warn: number; fail: number };
  exitCode: 0 | 1 | 2;
}

// ─────────────────────────────────────────────────────────────
// Pure output rendering (no stdout writes, no process mutation)
// ─────────────────────────────────────────────────────────────

const ID_COL = 22;
const STATUS_COL = 8;
const DETAIL_COL = 60;
const TOTAL_COL = ID_COL + STATUS_COL + DETAIL_COL;

function padRight(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

function statusLabel(status: CheckStatus): string {
  return status.toUpperCase();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + "…";
}

function rowText(title: string, status: CheckStatus, detail: string): string {
  const detailPart = truncate(detail, DETAIL_COL);
  const line = padRight(title, ID_COL) + padRight(statusLabel(status), STATUS_COL) + detailPart;
  return line.slice(0, TOTAL_COL);
}

function headerRow(): string {
  return padRight("CHECK", ID_COL) + padRight("STATUS", STATUS_COL) + "DETAIL";
}

export function toJsonReport(report: DoctorReport): string {
  // JSON.stringify never emits \r; we also scrub the startedAt just in case
  // a caller passes a value with CRLF. The output is guaranteed single-line
  // and CR-free even when os.EOL === "\r\n".
  const safeReport: DoctorReport = {
    ...report,
    startedAt: report.startedAt.replace(/\r/g, ""),
    checks: report.checks.map((check) => {
      const base: CheckResult = {
        id: check.id,
        title: check.title,
        status: check.status,
      };
      if (check.detail !== undefined) {
        base.detail = redactSensitiveText(check.detail);
      }
      if (check.data !== undefined) {
        base.data = redactUnknown(check.data);
      }
      return base;
    }),
  };
  return JSON.stringify(safeReport);
}

function redactSensitiveText(text: string): string {
  return text
    .replace(/(password|passwd|pwd|secret|token)\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/(YHAT_[A-Z0-9_]*(PASSWORD|TOKEN))/g, "[REDACTED]");
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactUnknown(entry));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactUnknown(v);
    }
    return out;
  }
  return value;
}

export function toTextReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(
    `yhat-mcp doctor v${report.version} (node ${report.node} / ${report.platform} / ${report.arch})`,
  );
  lines.push(report.startedAt);
  lines.push("");
  lines.push(headerRow());
  for (const check of report.checks) {
    const safeDetail = check.detail ? redactSensitiveText(check.detail) : "";
    lines.push(rowText(check.title, check.status, safeDetail));
  }
  lines.push("");
  lines.push(
    `Summary: ${report.summary.ok} OK, ${report.summary.warn} WARN, ${report.summary.fail} FAIL — exit ${report.exitCode}`,
  );
  return lines.join("\n");
}

export function formatReport(report: DoctorReport, mode: "text" | "json"): string {
  return mode === "json" ? toJsonReport(report) : toTextReport(report);
}

// ─────────────────────────────────────────────────────────────
// Individual checks
// ─────────────────────────────────────────────────────────────

export const checkVersion: Check = async () => {
  const pkgVersion = await readPackageVersion();
  const data = {
    pkg: "yhat-mcp-server",
    version: pkgVersion,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
  return {
    id: "version",
    title: "version",
    status: "ok",
    detail: `yhat-mcp-server ${pkgVersion}`,
    data,
  };
};

async function readPackageVersion(): Promise<string> {
  try {
    const raw = await readFile(join(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const checkConfigRoot: Check = async (ctx) => {
  try {
    await access(ctx.root, constants.F_OK);
  } catch {
    return {
      id: "config-root",
      title: "config-root",
      status: "fail",
      detail: `config root not found: ${ctx.root}`,
    };
  }
  try {
    await access(ctx.root, constants.W_OK);
  } catch {
    return {
      id: "config-root",
      title: "config-root",
      status: "warn",
      detail: `config root not writable: ${ctx.root}`,
    };
  }
  return {
    id: "config-root",
    title: "config-root",
    status: "ok",
    detail: ctx.root,
  };
};

const REQUIRED_ENV_KEYS = ["YHAT_DB_HOST", "YHAT_DB_PORT", "YHAT_DB_NAME", "YHAT_DB_USER"] as const;

function maskEnvVar(name: string, value: string | undefined): string {
  // Kept byte-identical with src/cli.ts:60; extraction is intentionally deferred.
  if (value === undefined || value === "") return `${name}=(not set)`;
  const lower = name.toLowerCase();
  if (lower.includes("password") || lower.includes("token") || lower.includes("secret")) {
    return `${name}=*** (set)`;
  }
  return `${name}=${value}`;
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(path, "utf8");
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      vars[key] = value;
    }
    return vars;
  } catch {
    return {};
  }
}

export const checkEnvFile: Check = async (ctx) => {
  const envVars = await readEnvFile(ctx.envPath);
  const present: string[] = [];
  const missing: string[] = [];
  for (const key of REQUIRED_ENV_KEYS) {
    const v = envVars[key];
    if (typeof v === "string" && v !== "") {
      present.push(maskEnvVar(key, v));
    } else {
      missing.push(key);
    }
  }

  if (missing.length === REQUIRED_ENV_KEYS.length) {
    return {
      id: "env-file",
      title: "env-file",
      status: "warn",
      detail: `missing all required keys: ${missing.join(", ")}`,
    };
  }

  if (missing.length > 0) {
    return {
      id: "env-file",
      title: "env-file",
      status: "warn",
      detail: `missing: ${missing.join(", ")}`,
    };
  }

  return {
    id: "env-file",
    title: "env-file",
    status: "ok",
    detail: present.join(", "),
  };
};

const TCP_PROBE_TIMEOUT_MS = 3000;

export const checkTcpConnectivity: Check = async (ctx) => {
  const host = ctx.config.database.host;
  const port = ctx.config.database.port;
  if (typeof host !== "string" || host === "" || typeof port !== "number" || port <= 0) {
    return {
      id: "tcp-connectivity",
      title: "tcp-connectivity",
      status: "fail",
      detail: "invalid host/port in config",
    };
  }

  return new Promise<CheckResult>((resolve) => {
    const started = performance.now();
    const socket = createConnection({ host, port });
    let settled = false;

    const settle = (result: CheckResult): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(TCP_PROBE_TIMEOUT_MS);

    socket.once("connect", () => {
      const durationMs = Math.round(performance.now() - started);
      settle({
        id: "tcp-connectivity",
        title: "tcp-connectivity",
        status: "ok",
        detail: `${durationMs}ms`,
        data: { durationMs },
      });
    });

    socket.once("timeout", () => {
      settle({
        id: "tcp-connectivity",
        title: "tcp-connectivity",
        status: "warn",
        detail: `tcp probe timeout after ${TCP_PROBE_TIMEOUT_MS}ms`,
      });
    });

    socket.once("error", (error: NodeJS.ErrnoException) => {
      const code = error.code ?? "UNKNOWN";
      if (code === "ETIMEDOUT") {
        settle({
          id: "tcp-connectivity",
          title: "tcp-connectivity",
          status: "warn",
          detail: `tcp probe timeout after ${TCP_PROBE_TIMEOUT_MS}ms`,
        });
        return;
      }
      settle({
        id: "tcp-connectivity",
        title: "tcp-connectivity",
        status: "fail",
        detail: `tcp connection failed: ${code}`,
      });
    });
  });
};

export const checkWhitelist: Check = async (ctx) => {
  const whitelist = ctx.config.whitelist;
  const schemaCount = whitelist.length;
  let tableCount = 0;
  for (const entry of whitelist) {
    tableCount += entry.tables.length;
  }

  const schemas = whitelist.map((entry) => ({
    schema: entry.schema,
    tables: [...entry.tables],
  }));

  if (schemaCount === 0) {
    return {
      id: "whitelist",
      title: "whitelist",
      status: "warn",
      detail: "0 schemas, 0 tables",
      data: { schemas: [] },
    };
  }

  return {
    id: "whitelist",
    title: "whitelist",
    status: "ok",
    detail: `${schemaCount} schemas, ${tableCount} tables`,
    data: { schemas },
  };
};

// ─────────────────────────────────────────────────────────────
// PR2 checks
// ─────────────────────────────────────────────────────────────

export const checkKeychain: Check = async (ctx) => {
  if (ctx.secretStore === null) {
    if (process.platform === "win32") {
      return {
        id: "keychain",
        title: "keychain",
        status: "warn",
        detail: "keytar prebuild not available; password will fall back to env",
      };
    }
    return {
      id: "keychain",
      title: "keychain",
      status: "fail",
      detail: "keytar unavailable; install libsecret-1-0 and run yhat-mcp setup",
    };
  }

  const secret = await loadSecret(KEYTAR_ACCOUNT, process.env, ctx.secretStore);
  if (secret === null) {
    return {
      id: "keychain",
      title: "keychain",
      status: "fail",
      detail: "missing secret: run yhat-mcp setup",
    };
  }

  return { id: "keychain", title: "keychain", status: "ok", detail: "secret present" };
};

const ACTIVE_AUDIT_FILE = /^audit-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.ndjson$/;

export const checkAuditLog: Check = async (ctx) => {
  const logDir = resolveAuditLogDir(ctx.config.audit.logDir, ctx.root);
  try {
    await stat(logDir);
    await access(logDir, constants.W_OK);
  } catch {
    return {
      id: "audit-log",
      title: "audit-log",
      status: "fail",
      detail: `audit log directory unavailable: ${logDir}`,
    };
  }

  let sizeBytes = 0;
  try {
    const entries = await readdir(logDir, { withFileTypes: true });
    const active = entries.find((entry) => entry.isFile() && ACTIVE_AUDIT_FILE.test(entry.name));
    if (active !== undefined) {
      sizeBytes = (await stat(join(logDir, active.name))).size;
    }
  } catch {
    sizeBytes = 0;
  }

  const maxBytes = ctx.config.audit.maxSizeMb * 1_048_576;
  const sizeMb = (sizeBytes / 1_048_576).toFixed(1);
  if (sizeBytes >= maxBytes * 0.9) {
    return {
      id: "audit-log",
      title: "audit-log",
      status: sizeBytes <= maxBytes ? "warn" : "fail",
      detail: `current file near limit (${sizeMb} / ${ctx.config.audit.maxSizeMb} MB)`,
    };
  }
  return { id: "audit-log", title: "audit-log", status: "ok", detail: `current file ${sizeMb} MB` };
};

interface OpenCodeConfig {
  mcp?: Record<string, unknown>;
}

const OPENCODE_CONFIG_PATH = join(
  process.env.HOME ?? process.env.USERPROFILE ?? "",
  ".config",
  "opencode",
  "opencode.json",
);

export const checkOpenCodeRegistration: Check = async () => {
  let config: OpenCodeConfig;
  try {
    const content = await readFile(OPENCODE_CONFIG_PATH, "utf8");
    config = JSON.parse(content) as OpenCodeConfig;
  } catch {
    return { id: "opencode-registration", title: "opencode-registration", status: "fail", detail: "opencode config not found" };
  }
  if (config.mcp?.["yhat-sql"] !== undefined) {
    return { id: "opencode-registration", title: "opencode-registration", status: "ok", detail: "yhat-sql registered" };
  }
  return { id: "opencode-registration", title: "opencode-registration", status: "warn", detail: "yhat-sql not in mcp config" };
};

function sanitizeAuthError(message: string): string {
  return message.replace(/(password|passwd|pwd|secret|token|connection\s*string)\s*[:=]?\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

export const checkAuthRoundtrip: Check = async (ctx) => {
  const timeoutSeconds = ctx.config.limits?.queryTimeoutSeconds;
  if (timeoutSeconds === undefined) {
    return {
      id: "auth-roundtrip",
      title: "auth-roundtrip",
      status: "fail",
      detail: "config missing queryTimeoutSeconds; cannot run auth check",
    };
  }
  const secret = await loadSecret(ctx.config.database.passwordEnv, process.env, ctx.secretStore);
  if (secret === null) {
    return { id: "auth-roundtrip", title: "auth-roundtrip", status: "fail", detail: "credentials not stored" };
  }

  const pool = new sql.ConnectionPool({
    server: ctx.config.database.host,
    database: ctx.config.database.name,
    user: ctx.config.database.user,
    password: secret,
    port: ctx.config.database.port,
    options: {
      encrypt: ctx.config.database.encrypt,
      trustServerCertificate: ctx.config.database.trustServerCertificate ?? false,
      connectTimeout: timeoutSeconds * 1000,
      requestTimeout: timeoutSeconds * 1000,
    },
  });
  const started = performance.now();
  try {
    await pool.connect();
    await pool.request().query("SELECT 1");
    const durationMs = Math.round(performance.now() - started);
    return { id: "auth-roundtrip", title: "auth-roundtrip", status: "ok", detail: `${durationMs}ms`, data: { durationMs } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: "auth-roundtrip", title: "auth-roundtrip", status: "fail", detail: `auth failed: ${sanitizeAuthError(message)}` };
  } finally {
    await pool.close().catch(() => undefined);
  }
};


export interface DoctorFlags {
  checkAuth: boolean;
}

export interface DoctorDependencies {
  root: string;
  envPath: string;
  config: Config;
  secretStore: SecretStore | null;
  pkgVersion: string;
  checks: readonly Check[];
}

export interface DoctorOptions {
  flags: DoctorFlags;
  deps: DoctorDependencies;
}

export const STANDARD_CHECKS: readonly Check[] = [
  checkVersion,
  checkConfigRoot,
  checkEnvFile,
  checkTcpConnectivity,
  checkWhitelist,
];

export function buildContext(deps: DoctorDependencies, flags: DoctorFlags): CheckContext {
  return {
    root: deps.root,
    envPath: deps.envPath,
    config: deps.config,
    secretStore: deps.secretStore,
    flags,
    pkgVersion: deps.pkgVersion,
  };
}

export async function executeChecks(
  ctx: CheckContext,
  checks: readonly Check[],
): Promise<readonly CheckResult[]> {
  const results: CheckResult[] = [];
  let index = 0;
  for (const check of checks) {
    const fallbackId = `check-${index++}`;
    try {
      const result = await check(ctx);
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        id: fallbackId,
        title: fallbackId,
        status: "fail",
        detail: `internal error: ${message}`,
      });
    }
  }
  return results;
}

export interface Summary {
  ok: number;
  warn: number;
  fail: number;
  exitCode: 0 | 1 | 2;
}

export function aggregateSummary(checks: readonly CheckResult[]): Summary {
  let okCount = 0;
  let warnCount = 0;
  let failCount = 0;
  for (const check of checks) {
    if (check.status === "ok") okCount++;
    else if (check.status === "warn") warnCount++;
    else failCount++;
  }
  const exitCode: 0 | 1 | 2 = failCount > 0 ? 2 : warnCount > 0 ? 1 : 0;
  return { ok: okCount, warn: warnCount, fail: failCount, exitCode };
}

export async function runChecks(
  checks: readonly Check[],
  deps: DoctorDependencies,
  flags: DoctorFlags,
): Promise<DoctorReport> {
  const ctx = buildContext(deps, flags);
  const results = await executeChecks(ctx, checks);
  const summary = aggregateSummary(results);
  return {
    version: deps.pkgVersion,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    startedAt: new Date().toISOString(),
    checks: results,
    summary: { ok: summary.ok, warn: summary.warn, fail: summary.fail },
    exitCode: summary.exitCode,
  };
}

export const ALL_CHECKS: readonly Check[] = [
  ...STANDARD_CHECKS,
  checkKeychain,
  checkAuditLog,
  checkOpenCodeRegistration,
];

/**
 * Runs the configured checks. STANDARD_CHECKS is readonly, so aggregation
 * must spread it into a new array rather than reassigning or mutating it.
 */
export async function runDoctorCore(options: DoctorOptions): Promise<DoctorReport> {
  const checks = options.deps.checks.length > 0 ? options.deps.checks : ALL_CHECKS;
  const selectedChecks = options.flags.checkAuth ? [...checks, checkAuthRoundtrip] : checks;
  return runChecks(selectedChecks, options.deps, options.flags);
}

// ─────────────────────────────────────────────────────────────
// TTY detection and render dispatch (T13)
// ─────────────────────────────────────────────────────────────

export type OutputMode = "text" | "json";

export function detectOutputMode(): OutputMode {
  // Strict === true to avoid classifying Windows GUI terminals as TTY
  // when they report a non-true value. Default is JSON so CI output is
  // always machine-parseable.
  return process.stdout.isTTY === true ? "text" : "json";
}

export function renderReport(report: DoctorReport): string {
  return formatReport(report, detectOutputMode());
}