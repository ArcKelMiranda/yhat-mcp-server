import type { Config } from "./types.js";
import type { SecretStore } from "./keytar.js";

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