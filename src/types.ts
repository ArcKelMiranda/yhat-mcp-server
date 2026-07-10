export const TRANSPORT = {
  STDIO: "stdio",
} as const;

export type Transport = (typeof TRANSPORT)[keyof typeof TRANSPORT];

export const SERVER_STATE = {
  STOPPED: "stopped",
  STARTING: "starting",
  RUNNING: "running",
  STOPPING: "stopping",
} as const;

export type ServerState = (typeof SERVER_STATE)[keyof typeof SERVER_STATE];

export const SHUTDOWN_REASON = {
  MANUAL: "manual",
  SIGNAL: "signal",
  STDIN_CLOSE: "stdin-close",
} as const;

export type ShutdownReason = (typeof SHUTDOWN_REASON)[keyof typeof SHUTDOWN_REASON];

export const ACCESS_MODE = {
  READ_ONLY: "read_only",
  READ_WRITE: "read_write",
} as const;

export type AccessMode = (typeof ACCESS_MODE)[keyof typeof ACCESS_MODE];

export const STATEMENT_TYPE = {
  SELECT: "SELECT",
  DML: "DML",
  DDL: "DDL",
  UNKNOWN: "UNKNOWN",
} as const;

export type StatementType = (typeof STATEMENT_TYPE)[keyof typeof STATEMENT_TYPE];

export const BLOCK_RULE = {
  PARSE_ERROR: "parse_error",
  MULTI_STATEMENT: "multi_statement",
  NON_SELECT: "non_select",
  UNSAFE_WHERE: "unsafe_where",
  WHITELIST_DENIED: "whitelist_denied",
  ROW_LIMIT_EXCEEDED: "row_limit_exceeded",
} as const;

export type BlockRule = (typeof BLOCK_RULE)[keyof typeof BLOCK_RULE];

export interface AppInfo {
  name: string;
  transport: Transport;
}

export interface ServerConfig {
  name: string;
  transport: Transport;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  passwordEnv: string;
  encrypt: boolean;
  trustServerCertificate?: boolean;
}

export interface WhitelistEntry {
  schema: string;
  tables: readonly string[];
  mode: AccessMode;
}

export interface LimitsConfig {
  maxRows: number;
  queryTimeoutSeconds: number;
  largeTableColumnThreshold?: number;
  largeTableRowThreshold?: number;
  rateLimitPerMinute?: number;
}

export interface AuditConfig {
  logDir: string;
  maxSizeMb: number;
  maxAgeDays: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface Config {
  server: ServerConfig;
  database: DatabaseConfig;
  whitelist: readonly WhitelistEntry[];
  limits: LimitsConfig;
  audit: AuditConfig;
}

export interface TableReference {
  schema?: string;
  name: string;
  alias?: string;
}

export interface QueryClassification {
  type: StatementType;
  tables: readonly TableReference[];
  hasWhereClause: boolean;
  isAlwaysTrueWhere: boolean;
  isSelectAll: boolean;
}

export interface BlockReason {
  rule: BlockRule;
  message: string;
}

export interface QueryGuardResult {
  allowed: boolean;
  classification: QueryClassification;
  reason?: BlockReason;
}

export interface WhitelistDecision {
  allowed: boolean;
  matchedTables: readonly TableReference[];
  reason?: BlockReason;
}

export interface TableStatistics {
  schema?: string;
  name: string;
  columnCount?: number;
  estimatedRowCount?: number;
}

export interface RowLimitResult {
  allowed: boolean;
  rowCount: number;
  limit: number;
  warning?: string;
  reason?: BlockReason;
}

export interface QueryParameters {
  readonly [name: string]: unknown;
}

export interface QueryToolInput {
  sql: string;
  parameters?: QueryParameters;
}

export interface QueryExecutionRow {
  readonly [column: string]: unknown;
}

export interface QueryExecutionResult {
  rows: readonly QueryExecutionRow[];
  rowCount: number;
  durationMs: number;
  warning?: string;
}

export interface DatabaseClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  executeSelect(query: QueryToolInput, timeoutSeconds: number): Promise<QueryExecutionResult>;
}

export interface AuditEntry {
  timestamp: string;
  userIdentity: string;
  clientInfo?: string;
  queryText: string;
  tables: readonly string[];
  status: "ALLOWED" | "BLOCKED";
  rowsReturned: number | null;
  durationMs: number;
  errorCategory?: string;
  configVersion?: string;
}

export interface AuditLogger {
  log(entry: AuditEntry): Promise<void>;
  snapshotMetrics(): Readonly<Record<string, number>>;
  close(): Promise<void>;
}

export interface ServerBootstrapOptions {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: NodeJS.ReadStream;
  signals?: readonly NodeJS.Signals[];
}

export interface ServerRuntime {
  readonly state: ServerState;
  start(): Promise<void>;
  stop(reason?: ShutdownReason): Promise<void>;
}

export interface ServerOptions {
  name: string;
  stdin?: NodeJS.ReadStream;
  signals?: readonly NodeJS.Signals[];
}

export const APP_INFO = {
  name: "yhat-mcp-server",
  transport: TRANSPORT.STDIO,
} as const satisfies AppInfo;
