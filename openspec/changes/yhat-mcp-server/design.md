# Design: Yhat MCP Server — Phase 1 MVP

## Technical Approach

Build a single-process stdio MCP server using `@modelcontextprotocol/sdk`. The server exposes one tool, `yhat_query`, that receives a SQL string and bound parameters. **Phase 1 is strictly read-only: the Query Guard only allows `SELECT` statements. All DDL and DML (`INSERT`, `UPDATE`, `DELETE`, `MERGE`, etc.) are blocked before execution for every role, including `admin`.**

On startup the server loads `config/yhat-mcp-config.yaml`, interpolates `${VAR}` placeholders from environment variables, validates the result with Zod 4, and opens an `mssql` connection pool. Each request flows through argument validation, Query Guard AST analysis, SQL Whitelist authorization, row-limit checks, parameterized execution, and metadata-only audit logging. The approach maps to the capability specs: `mcp-server`, `config-loader`, `query-guard`, `sql-whitelist`, `row-limit`, and `audit-logging`.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Transport | stdio | SSE, HTTP | Native support in Claude Desktop/Cursor/VS Code; no ports; simplest process model. |
| SQL Server driver | `mssql` | `tedious`, `node-odbc` | Promise-based driver with pooling and parameter binding; built on `tedious`. |
| Configuration | YAML + Zod 4 | JSON + Zod, env-only | Matches PRD; human-readable whitelist; fast-fail validation. |
| Guard/Whitelist split | Layered: Query Guard decides statement type; Whitelist decides namespace access for `SELECT` only. | Single component, or guard owns everything | Guard knows SQL semantics; whitelist knows data access. No DML path in v1, so whitelist only validates `SELECT` tables. |
| SQL parsing | `node-sql-parser` (transactsql) with regex fallback | Regex only, custom parser | AST gives reliable statement detection; regex fallback covers parser gaps and multi-statement defense. |
| Build toolchain | `tsc` + `tsx` | `tsup`, `esbuild` | Familiar two-step build; `tsx` for fast local dev. |
| Audit logger | `pino` | `winston` | Structured JSON, redaction, rotation, and low overhead. |

**Guard/Whitelist responsibility resolution:** The Query Guard owns the statement-type decision. It parses SQL, rejects malformed or multi-statement queries, and blocks every statement that is not a plain `SELECT`. It does not evaluate roles or access modes. The SQL Whitelist owns the namespace decision for `SELECT`: every referenced schema and table must be whitelisted. Because no DML path exists in v1, `read_write` is accepted for forward compatibility but grants no write permissions. The handler rejects a query if either layer rejects it, and the audit log records which layer blocked it.

## Data Flow

```
MCP Client
    │
    │ JSON-RPC / stdio
    ▼
┌────────────────┐
│ stdio transport │
└────────────────┘
    │
    ▼
┌────────────────┐     ┌────────────────┐
│  Tool router   │────▶│  Arg validation │
└────────────────┘     └────────────────┘
    │
    ▼
┌────────────────┐     ┌────────────────┐
│  Query Guard   │────▶│ AST classification │
│ (SELECT-only,  │     │  tables, WHERE,    │
│  DDL/DML block)│     │  multi-statement   │
└────────────────┘     └────────────────┘
    │
    ▼
┌────────────────┐
│ SQL Whitelist  │── reject if schema/table not whitelisted for SELECT
└────────────────┘
    │
    ▼
┌────────────────┐     ┌────────────────┐
│  Row Limit     │────▶│ large-table warning
│  (maxRows)     │     │
└────────────────┘     └────────────────┘
    │
    ▼
┌────────────────┐
│   mssql pool   │── parameterized query
└────────────────┘
    │
    ▼
┌────────────────┐
│ Result formatter│
└────────────────┘
    │
    ├────────────────────▶ Audit logger (metadata only)
    ▼
MCP Client response
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Create | Project manifest. |
| `tsconfig.json` | Create | Strict TypeScript compiler options. |
| `src/index.ts` | Create | CLI entry, startup, shutdown. |
| `src/server.ts` | Create | MCP server setup and `yhat_query` routing. |
| `src/config.ts` | Create | YAML loader, env interpolation, Zod 4 validation. |
| `src/types.ts` | Create | Const-derived types. `admin` is reserved for future writes. |
| `src/validator.ts` | Create | Query Guard: AST parse, classification, SELECT-only checks. |
| `src/whitelist.ts` | Create | Whitelist lookup for SELECT; no DML logic in v1. |
| `src/role.ts` | Create | Minimal role resolver; returns `reader` for all inputs in Fase 1. |
| `src/database.ts` | Create | `mssql` pool and parameterized execution. |
| `src/audit.ts` | Create | Structured pino audit logger with redaction. |
| `src/row-limit.ts` | Create | Max-row enforcement and large-table warning. |
| `src/guards.ts` | Create | Runtime type guards for `unknown` inputs. |
| `config/yhat-mcp-config.yaml` | Create | Default server configuration and whitelist. |
| `tests/` | Create | Vitest unit, integration, and security tests. |
| `docker-compose.yml` | Create | Optional SQL Server integration target. |

## Interfaces / Contracts

```typescript
import type { z } from "zod";

// Fase 1 only uses READER. ADMIN is reserved for future write support and has
// no additional permissions in this phase.
const ROLE = { READER: "reader", ADMIN: "admin" } as const;
type Role = (typeof ROLE)[keyof typeof ROLE];

// Fase 1 enforces read_only. read_write is accepted for forward compatibility
// but grants no DML access because all DML is blocked.
const ACCESS_MODE = { READ_ONLY: "read_only", READ_WRITE: "read_write" } as const;
type AccessMode = (typeof ACCESS_MODE)[keyof typeof ACCESS_MODE];

const STATEMENT_TYPE = { SELECT: "SELECT", DML: "DML", DDL: "DDL", UNKNOWN: "UNKNOWN" } as const;
type StatementType = (typeof STATEMENT_TYPE)[keyof typeof STATEMENT_TYPE];

interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  passwordEnv: string;
  encrypt: boolean;
  trustServerCertificate?: boolean;
}

interface WhitelistEntry {
  schema: string;
  tables: string[];
  mode: AccessMode;
}

interface LimitsConfig {
  maxRows: number;
  queryTimeoutSeconds: number;
  largeTableColumnThreshold?: number;
  largeTableRowThreshold?: number;
  rateLimitPerMinute?: number;
}

interface AuditConfig {
  logDir: string;
  maxSizeMb: number;
  maxAgeDays: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

interface AppConfig {
  server: { name: string; transport: "stdio" };
  database: DatabaseConfig;
  whitelist: WhitelistEntry[];
  limits: LimitsConfig;
  audit: AuditConfig;
}

const databaseConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().max(65535),
  name: z.string().min(1),
  user: z.string().min(1),
  passwordEnv: z.string().min(1),
  encrypt: z.boolean().default(true),
  trustServerCertificate: z.boolean().optional(),
});

const whitelistEntrySchema = z.object({
  schema: z.string().min(1),
  tables: z.array(z.string().min(1)).min(1),
  mode: z.enum([ACCESS_MODE.READ_ONLY, ACCESS_MODE.READ_WRITE]).default(ACCESS_MODE.READ_ONLY),
});

const limitsConfigSchema = z.object({
  maxRows: z.number().int().positive().default(1000),
  queryTimeoutSeconds: z.number().int().positive().default(30),
  largeTableColumnThreshold: z.number().int().positive().optional(),
  largeTableRowThreshold: z.number().int().positive().optional(),
  rateLimitPerMinute: z.number().int().positive().optional(),
});

const appConfigSchema = z.object({
  server: z.object({ name: z.string().min(1), transport: z.literal("stdio") }),
  database: databaseConfigSchema,
  whitelist: z.array(whitelistEntrySchema).min(1),
  limits: limitsConfigSchema,
  audit: z.object({
    logDir: z.string().min(1),
    maxSizeMb: z.number().int().positive().default(50),
    maxAgeDays: z.number().int().positive().default(30),
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  }),
});

type ValidatedAppConfig = Readonly<z.infer<typeof appConfigSchema>>;

interface TableReference {
  schema: string;
  name: string;
  alias?: string;
}

interface QueryClassification {
  type: StatementType;
  tables: TableReference[];
  hasWhereClause?: boolean;
  isAlwaysTrueWhere?: boolean;
}

interface QueryParameter {
  name: string;
  value: unknown;
  sqlType: string;
}

interface QueryResult<T> {
  rows: T[];
  rowCount: number;
  durationMs: number;
  warning?: string;
}

interface AuditEntry {
  timestamp: string;
  userIdentity: string;
  clientInfo?: string;
  queryText: string;
  tables: string[];
  status: "ALLOWED" | "BLOCKED";
  rowsAffected: number | null;
  durationMs: number;
  errorCategory?: string;
  configVersion?: string;
}

interface ToolRequest {
  toolName: string;
  arguments: Record<string, unknown>;
}

interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

// Minimal role resolver for Fase 1. Future phases can extend this once DML is
// enabled.
function resolveRole(input?: string): Role {
  return input === ROLE.ADMIN ? ROLE.ADMIN : ROLE.READER;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Config loader, Query Guard, Whitelist, Row Limit, Audit formatter | Vitest with mocked `mssql` and file system |
| Integration | End-to-end query execution against SQL Server | Docker Compose `mcr.microsoft.com/mssql/server`; tagged `test:integration` |
| Security | DDL/DML blocking for all roles, injection attempts, secret redaction, row-limit bypass | Vitest with static malicious query strings |
| Coverage | All modules | Vitest `--coverage`; target >80% |

## Migration / Rollout

No migration required. This is a greenfield project; rollout is a fresh install of the package, configuration file, and read-only SQL Server account.

## Open Questions

- Should the default audit log directory be `./logs`, `os.tmpdir()`, or a configurable absolute path?
- Should large-table thresholds be catalog-driven or config-driven?
- Admin DML and `read_write` mode are out of scope in Fase 1. For the future write phase, should we use a client confirmation flow or a server-side approval queue?
- Should views be explicitly whitelisted, or implicitly allowed within a whitelisted schema?
