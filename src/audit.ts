import { appendFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

import type { AuditEntry, AuditLogger, AuditConfig } from "./types.js";

interface AuditState {
  metrics: Map<string, number>;
  activeLogFile: string;
}

export function createAuditLogger(config: AuditConfig): AuditLogger {
  const state: AuditState = {
    metrics: new Map<string, number>(),
    activeLogFile: buildActiveLogFile(config.logDir),
  };

  const log = async (entry: AuditEntry): Promise<void> => {
    await ensureLogDirectory(config.logDir);
    await pruneExpiredLogs(config.logDir, config.maxAgeDays);
    await rotateIfNeeded(config.logDir, config.maxSizeMb, state);

    const sanitized = sanitizeAuditEntry(entry);
    await appendFile(state.activeLogFile, `${JSON.stringify(sanitized)}\n`, "utf8");

    incrementMetric(state.metrics, `audit.${sanitized.status.toLowerCase()}`);
    incrementMetric(state.metrics, "audit.total");
    incrementMetric(state.metrics, `audit.rows.${sanitized.rowsReturned ?? 0}`);
  };

  const snapshotMetrics = (): Readonly<Record<string, number>> => {
    return Object.freeze(Object.fromEntries(state.metrics));
  };

  const close = async (): Promise<void> => {
    await ensureLogDirectory(config.logDir);
  };

  return {
    log,
    snapshotMetrics,
    close,
  };
}

function sanitizeAuditEntry(entry: AuditEntry): AuditEntry {
  const sanitized: AuditEntry = {
    ...entry,
    queryText: redactSqlText(entry.queryText),
  };

  if (entry.clientInfo !== undefined) {
    sanitized.clientInfo = redactSensitiveText(entry.clientInfo);
  }

  if (entry.errorCategory !== undefined) {
    sanitized.errorCategory = redactSensitiveText(entry.errorCategory);
  }

  if (entry.configVersion !== undefined) {
    sanitized.configVersion = redactSensitiveText(entry.configVersion);
  }

  return sanitized;
}

function redactSensitiveText(text: string): string {
  return text
    .replace(/(password|passwd|pwd|secret|token|connection\s*string)\s*[:=]\s*([^\s;]+)/gi, "$1=[REDACTED]")
    .replace(/(YHAT_[A-Z0-9_]*PASSWORD|YHAT_[A-Z0-9_]*TOKEN)/g, "[REDACTED]");
}

function redactSqlText(sql: string): string {
  return sql
    .replace(/'(?:''|[^'])*'/g, "'?'" )
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
}

async function ensureLogDirectory(logDir: string): Promise<void> {
  await mkdir(logDir, { recursive: true });
}

async function pruneExpiredLogs(logDir: string, maxAgeDays: number): Promise<void> {
  const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const files = await readdir(logDir, { withFileTypes: true });

  await Promise.all(
    files
      .filter((entry) => entry.isFile() && entry.name.startsWith("audit-"))
      .map(async (entry) => {
        const filePath = join(logDir, entry.name);
        const fileStat = await stat(filePath);

        if (fileStat.mtimeMs < cutoffTime) {
          await unlink(filePath);
        }
      }),
  );
}

async function rotateIfNeeded(logDir: string, maxSizeMb: number, state: AuditState): Promise<void> {
  const filePath = state.activeLogFile;

  try {
    const fileStat = await stat(filePath);
    const maxBytes = maxSizeMb * 1024 * 1024;

    if (fileStat.size >= maxBytes) {
      const rotatedPath = buildRotatedLogFile(logDir);
      await rename(filePath, rotatedPath);
      state.activeLogFile = buildActiveLogFile(logDir);
    }
  } catch {
    state.activeLogFile = buildActiveLogFile(logDir);
  }
}

function buildActiveLogFile(logDir: string): string {
  return join(logDir, `audit-${formatDateTag(new Date())}.ndjson`);
}

function buildRotatedLogFile(logDir: string): string {
  return join(logDir, `audit-${formatDateTag(new Date())}-${Date.now()}.ndjson`);
}

function formatDateTag(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function incrementMetric(metrics: Map<string, number>, name: string): void {
  const current = metrics.get(name) ?? 0;
  metrics.set(name, current + 1);
}
