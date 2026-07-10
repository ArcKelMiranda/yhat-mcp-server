import process from "node:process";

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { loadConfigFile, DEFAULT_CONFIG_PATH } from "./config.js";
import { createAuditLogger } from "./audit.js";
import { createDatabaseClient } from "./database.js";
import { enforceRowLimit } from "./row-limit.js";
import { classifyQuery } from "./validator.js";
import { authorizeQueryTables } from "./whitelist.js";
import {
  type AuditEntry,
  type AuditLogger,
  type DatabaseClient,
  SERVER_STATE,
  SHUTDOWN_REASON,
  type QueryGuardResult,
  type QueryToolInput,
  type ServerBootstrapOptions,
  type ServerRuntime,
  type ServerState,
} from "./types.js";

const DEFAULT_SIGNALS = ["SIGINT", "SIGTERM"] as const;

const queryInputSchema = z.object({
  sql: z.string().min(1, { error: "sql is required" }),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

interface ServerResources {
  database: DatabaseClient;
  audit: AuditLogger;
  mcpServer: McpServer;
  transport: StdioServerTransport;
}

export function createServer(options: ServerBootstrapOptions = {}): ServerRuntime {
  const stdin = options.stdin ?? process.stdin;
  const signals = options.signals ?? DEFAULT_SIGNALS;
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;

  let state: ServerState = SERVER_STATE.STOPPED;
  let started = false;
  let stopping = false;
  let resources: ServerResources | null = null;

  let resolveStop: (() => void) | null = null;
  const stopPromise = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });

  const registerLifecycleHandlers = (): void => {
    stdin.on("close", handleStdinClose);

    for (const signal of signals) {
      process.on(signal, handleSignal);
    }
  };

  const removeLifecycleHandlers = (): void => {
    stdin.removeListener("close", handleStdinClose);

    for (const signal of signals) {
      process.removeListener(signal, handleSignal);
    }
  };

  const stop = async (_reason: string = SHUTDOWN_REASON.MANUAL): Promise<void> => {
    if (stopping || state === SERVER_STATE.STOPPED) {
      return;
    }

    stopping = true;
    state = SERVER_STATE.STOPPING;
    removeLifecycleHandlers();

    try {
      if (resources !== null) {
        await Promise.allSettled([
          resources.transport.close(),
          resources.database.close(),
          resources.audit.close(),
        ]);
      }
    } finally {
      resources = null;
      state = SERVER_STATE.STOPPED;
      resolveStop?.();
    }
  };

  const handleSignal = (): void => {
    void stop(SHUTDOWN_REASON.SIGNAL);
  };

  const handleStdinClose = (): void => {
    void stop(SHUTDOWN_REASON.STDIN_CLOSE);
  };

  const start = async (): Promise<void> => {
    if (started) {
      await stopPromise;
      return;
    }

    started = true;
    state = SERVER_STATE.STARTING;

    try {
      const config = await loadConfigFile(configPath, env);
      const database = createDatabaseClient(config.database, env);
      const audit = createAuditLogger(config.audit);

      await database.connect();

      const mcpServer = new McpServer({
        name: config.server.name,
        version: "0.1.0",
      });

      registerQueryTool(mcpServer, env, configPath, database, audit, config.whitelist, config.limits);

      const transport = new StdioServerTransport();
      resources = { database, audit, mcpServer, transport };

      registerLifecycleHandlers();

      await mcpServer.connect(transport);
      state = SERVER_STATE.RUNNING;

      await stopPromise;
    } catch (error) {
      await stop(SHUTDOWN_REASON.MANUAL);
      throw error;
    }
  };

  return {
    get state(): ServerState {
      return state;
    },
    start,
    stop,
  };
}

function registerQueryTool(
  server: McpServer,
  env: NodeJS.ProcessEnv,
  configPath: string,
  database: DatabaseClient,
  audit: AuditLogger,
  whitelist: readonly { schema: string; tables: readonly string[]; mode: "read_only" | "read_write" }[],
  limits: { maxRows: number; queryTimeoutSeconds: number; largeTableColumnThreshold?: number; largeTableRowThreshold?: number; rateLimitPerMinute?: number },
): void {
  server.registerTool(
    "yhat_query",
    {
      description: "Execute a read-only SELECT query against the whitelisted SQL Server schema.",
      inputSchema: queryInputSchema,
    },
    async ({ sql, parameters }) => {
      const startedAt = Date.now();
      const queryInput: QueryToolInput = {
        sql,
        ...(parameters === undefined ? {} : { parameters }),
      };
      const classificationResult = classifyQuery(sql);

      if (!classificationResult.allowed) {
        await emitAudit(audit, env, configPath, queryInput, classificationResult, startedAt, null);
        return blockedResponse(classificationResult);
      }

      const whitelistDecision = authorizeQueryTables(classificationResult.classification, whitelist);

      if (!whitelistDecision.allowed) {
        const blockedClassification: QueryGuardResult = {
          allowed: false,
          classification: classificationResult.classification,
          ...(whitelistDecision.reason === undefined ? {} : { reason: whitelistDecision.reason }),
        };

        await emitAudit(audit, env, configPath, queryInput, blockedClassification, startedAt, null);
        return blockedResponse(blockedClassification);
      }

      const executionResult = await database.executeSelect(queryInput, limits.queryTimeoutSeconds);
      const rowLimitResult = enforceRowLimit(classificationResult.classification, executionResult.rowCount, limits);

      if (!rowLimitResult.allowed) {
        const blockedClassification: QueryGuardResult = {
          allowed: false,
          classification: classificationResult.classification,
          ...(rowLimitResult.reason === undefined ? {} : { reason: rowLimitResult.reason }),
        };

        await emitAudit(audit, env, configPath, queryInput, blockedClassification, startedAt, executionResult.rowCount);
        return blockedResponse(blockedClassification);
      }

      const payload: QueryResponsePayload = {
        rowCount: executionResult.rowCount,
        rows: executionResult.rows,
      };

      if (rowLimitResult.warning !== undefined) {
        payload.warning = rowLimitResult.warning;
      }

      await emitAudit(audit, env, configPath, queryInput, classificationResult, startedAt, executionResult.rowCount);

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}

interface QueryResponsePayload {
  rowCount: number;
  rows: readonly Record<string, unknown>[];
  warning?: string;
}

async function emitAudit(
  audit: AuditLogger,
  env: NodeJS.ProcessEnv,
  configPath: string,
  queryInput: QueryToolInput,
  classificationResult: QueryGuardResult,
  startedAt: number,
  rowCount: number | null,
): Promise<void> {
  const tables = classificationResult.classification.tables.map((table) => formatQualifiedName(table.schema, table.name));
  const entry: AuditEntry = {
    timestamp: new Date(startedAt).toISOString(),
    userIdentity: resolveIdentity(env),
    queryText: queryInput.sql,
    tables,
    status: classificationResult.allowed ? "ALLOWED" : "BLOCKED",
    rowsReturned: rowCount,
    durationMs: Math.max(0, Date.now() - startedAt),
  };

  entry.clientInfo = "stdio";

  if (classificationResult.reason?.rule !== undefined) {
    entry.errorCategory = classificationResult.reason.rule;
  }

  entry.configVersion = configPath;

  await audit.log(entry);
}

function blockedResponse(result: QueryGuardResult): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return {
    content: [
      {
        type: "text",
        text: result.reason?.message ?? "Query blocked by policy.",
      },
    ],
    isError: true,
  };
}

function resolveIdentity(env: NodeJS.ProcessEnv): string {
  return env.USER ?? env.USERNAME ?? env.LOGNAME ?? "unknown";
}

function formatQualifiedName(schema: string | undefined, name: string): string {
  return schema === undefined ? name : `${schema}.${name}`;
}
