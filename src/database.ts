import { performance } from "node:perf_hooks";

import sql from "mssql";

import { resolveDatabasePassword } from "./keytar.js";
import type {
  DatabaseClient,
  DatabaseConfig,
  QueryExecutionResult,
  QueryExecutionRow,
  QueryToolInput,
} from "./types.js";

interface ConnectionState {
  pool: sql.ConnectionPool | null;
  connecting: Promise<sql.ConnectionPool> | null;
}

export function createDatabaseClient(config: DatabaseConfig, env: NodeJS.ProcessEnv = process.env): DatabaseClient {
  const state: ConnectionState = {
    pool: null,
    connecting: null,
  };

  const connect = async (): Promise<void> => {
    await ensurePool();
  };

  const close = async (): Promise<void> => {
    const currentPool = state.pool;
    state.pool = null;
    state.connecting = null;

    if (currentPool !== null) {
      await currentPool.close();
    }
  };

  const executeSelect = async (query: QueryToolInput, timeoutSeconds: number): Promise<QueryExecutionResult> => {
    const pool = await ensurePool();
    const request = pool.request() as sql.Request & { requestTimeout: number };
    request.requestTimeout = timeoutSeconds * 1000;

    for (const [name, value] of Object.entries(query.parameters ?? {})) {
      bindParameter(request, name, value);
    }

    const startedAt = performance.now();
    const result = await request.query(query.sql);
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    const rows = normalizeRecordset(result.recordset);

    return {
      rows,
      rowCount: rows.length,
      durationMs,
    };
  };

  const ensurePool = async (): Promise<sql.ConnectionPool> => {
    if (state.pool !== null) {
      return state.pool;
    }

    if (state.connecting !== null) {
      return state.connecting;
    }

    const password = await resolveDatabasePassword(config.passwordEnv, env);
    const poolConfig: sql.config = {
      user: config.user,
      password,
      server: config.host,
      database: config.name,
      port: config.port,
      options: {
        encrypt: config.encrypt,
        trustServerCertificate: config.trustServerCertificate ?? false,
      },
    };

    const pool = new sql.ConnectionPool(poolConfig);
    state.connecting = pool.connect();

    try {
      state.pool = await state.connecting;
      return state.pool;
    } finally {
      state.connecting = null;
    }
  };

  return {
    connect,
    close,
    executeSelect,
  };
}

function normalizeRecordset(recordset: unknown): readonly QueryExecutionRow[] {
  if (!Array.isArray(recordset)) {
    return [];
  }

  const rows: QueryExecutionRow[] = [];

  for (const row of recordset) {
    if (isPlainObject(row)) {
      rows.push({ ...row });
    }
  }

  return rows;
}

function bindParameter(request: sql.Request, name: string, value: unknown): void {
  if (value === null || value === undefined) {
    request.input(name, sql.NVarChar(sql.MAX), null);
    return;
  }

  if (typeof value === "string") {
    request.input(name, sql.NVarChar(sql.MAX), value);
    return;
  }

  if (typeof value === "number") {
    const type = Number.isInteger(value) ? sql.Int : sql.Float;
    request.input(name, type, value);
    return;
  }

  if (typeof value === "boolean") {
    request.input(name, sql.Bit, value);
    return;
  }

  if (value instanceof Date) {
    request.input(name, sql.DateTime2, value);
    return;
  }

  if (value instanceof Uint8Array) {
    request.input(name, sql.VarBinary(sql.MAX), Buffer.from(value));
    return;
  }

  if (typeof value === "bigint") {
    request.input(name, sql.NVarChar(sql.MAX), value.toString());
    return;
  }

  request.input(name, sql.NVarChar(sql.MAX), JSON.stringify(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
