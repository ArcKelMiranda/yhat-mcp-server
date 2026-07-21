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