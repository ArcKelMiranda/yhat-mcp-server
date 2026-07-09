# Exploration: Yhat MCP Server — TypeScript/Node.js implementation from PRD v1.1

## Context
- Source: `Yhat_MCP_Server_PRD_v1.1.docx` / `prd_extracted.txt`
- Original PRD stack: Python 3.10+ with Anthropic `mcp` SDK, `pyodbc`/`SQLAlchemy`
- Effective chosen stack: **TypeScript/Node.js (LTS 20/22)**
- Maturity: PRD-only; no source code, tests, or package manifest exists yet

This exploration updates the previous one to apply the TypeScript strict-convention skill and the Zod 4 schema conventions. The goal is to give `sdd-propose` a concrete, skill-aware implementation direction.

## Current State
- `sdd-init` detected the Python stack and persisted `openspec/config.yaml` and `openspec/init/sdd-init-MCP_SQLServer.md` with Python conventions.
- The team has decided to switch to TypeScript/Node.js; this exploration overrides the Python assumptions from `sdd-init`.
- Requirements remain stable: whitelist, Query Guard, RBAC, parameterized queries, audit logging, rate limiting, stdio/SSE transport, optional Docker.

## Affected Areas (planned)
- `package.json`, `tsconfig.json`, `pnpm-lock.yaml` — project manifest and strict TS config
- `src/index.ts` — CLI entry and transport selection
- `src/server.ts` — MCP `Server` setup, tool definitions, request routing
- `src/config.ts` — YAML loading, env interpolation, **Zod 4** validation
- `src/types.ts` — flat TypeScript interfaces derived from const types
- `src/secrets.ts` — secret resolution from env / secrets manager
- `src/validator.ts` — Query Guard (AST + regex)
- `src/database.ts` — `mssql` pool and parameterized query execution
- `src/audit.ts` — structured audit logger (metadata only)
- `src/rbac.ts` — role/permission engine
- `src/rate-limiter.ts` — token-bucket per-user limiter
- `src/guards.ts` — runtime type guards (no `any`)
- `config/yhat-mcp-config.yaml` — environment-specific whitelist and limits
- `tests/` — Vitest unit and integration tests
- `Dockerfile` — optional runtime container
- `README.md` — setup docs (Spanish per NFR-04)

## TypeScript Conventions to Apply

- **Const types pattern**: derive union types from const objects so runtime values and types share a single source of truth.

```typescript
const ROLE = {
  READER: "reader",
  WRITER: "writer",
  ADMIN: "admin",
} as const;
type Role = (typeof ROLE)[keyof typeof ROLE];

const TRANSPORT = { STDIO: "stdio", SSE: "sse" } as const;
type Transport = (typeof TRANSPORT)[keyof typeof TRANSPORT];
```

- **Flat interfaces**: one level of nesting; nested objects become their own interfaces.

```typescript
interface DatabaseConfig {
  host: string;
  name: string;
  encrypt: boolean;
  passwordEnv: string;
}

interface LimitsConfig {
  maxRows: number;
  queryTimeoutSeconds: number;
  rateLimitPerMinute: number;
}

interface AppConfig {
  database: DatabaseConfig;
  whitelist: WhitelistEntry[];
  roles: Record<Role, RoleConfig>;
  limits: LimitsConfig;
}
```

- **No `any`**: use `unknown` for external input, then validate with Zod or type guards.

```typescript
function isError(value: unknown): value is Error {
  return value instanceof Error;
}
```

- **Import types**: `import type { AppConfig } from "./types"`.
- **Utility types**: `Pick`, `Omit`, `Partial`, `Readonly`, `Record` for derived shapes (e.g., `Readonly<AppConfig>` for loaded config).

## Zod 4 Conventions to Apply

Use **Zod 4** for all runtime validation. Remember the breaking changes from Zod 3:

```typescript
// ❌ Zod 3
z.string().email()
z.string().nonempty()
z.object({ name: z.string() }).required_error("Required")

// ✅ Zod 4
z.email()
z.string().min(1)
z.object({ name: z.string() }, { error: "Required" })
```

Example config schema (the canonical shape of the loaded YAML):

```typescript
import { z } from "zod";

const roleConfigSchema = z.object({
  schemas: z.array(z.string().min(1)),
  requireConfirmation: z.boolean().default(false),
});

const whitelistEntrySchema = z.object({
  schema: z.string().min(1),
  tables: z.array(z.string().min(1)),
  mode: z.enum(["read_only", "read_write"]),
});

const databaseConfigSchema = z.object({
  host: z.string().min(1),
  name: z.string().min(1),
  encrypt: z.boolean().default(true),
  passwordEnv: z.string().min(1),
});

const limitsConfigSchema = z.object({
  maxRows: z.number().int().positive().default(1000),
  queryTimeoutSeconds: z.number().int().positive().default(30),
  rateLimitPerMinute: z.number().int().positive().default(30),
});

const appConfigSchema = z.object({
  database: databaseConfigSchema,
  whitelist: z.array(whitelistEntrySchema).min(1),
  roles: z.record(z.string().min(1), roleConfigSchema),
  limits: limitsConfigSchema,
});

type AppConfig = z.infer<typeof appConfigSchema>;
```

Secrets are never in the YAML; interpolate `${VAR}` tokens from `process.env` before parsing, then validate. Env var schemas (e.g., `YHAT_DB_PASSWORD`) are also Zod-validated in `src/secrets.ts`.

## Approaches

### 1. MCP SDK & Transport

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **A. `@modelcontextprotocol/sdk` stdio** (recommended) | Native support in Claude Desktop/Cursor/VS Code; no network ports; simple process model; easy local dev | One OS process per client; harder to scale horizontally | Low |
| **B. `@modelcontextprotocol/sdk` SSE** | Network-friendly; multi-client; easier containerization | Requires HTTP server; client support varies; more infra | Medium |

Recommendation: start with **stdio**. The PRD targets Claude Desktop, Cursor, and VS Code; stdio is the path of least resistance. Keep the transport selection abstract behind a `Transport` type so SSE can be added later without touching handlers.

### 2. SQL Server Driver

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **A. `mssql`** (recommended) | Promise-based; connection pooling; parameter binding; built on `tedious`; well documented | Slightly heavier abstraction | Low |
| **B. `tedious` directly** | Lower-level control; leaner | Verbose; manual connection/pool management; slower dev | Medium |
| **C. `node-odbc` + ODBC driver** | Uses native SQL Server ODBC | Native bindings; harder cross-platform dev/deploy; heavy | High |

Recommendation: use **`mssql`**. It is the standard actively maintained Node.js driver, supports `request.input()` for parameter binding, and its connection pool fits long-running MCP servers. The database layer should expose a narrow, typed interface:

```typescript
interface QueryResult<T> {
  rows: T[];
  rowCount: number;
  durationMs: number;
}

interface QueryExecutor {
  execute<T>(sql: string, params: QueryParameter[]): Promise<QueryResult<T>>;
}
```

### 3. Project Structure

Recommend a single `src/` package with flat, well-bounded modules:

- `src/index.ts` — CLI entry, transport selection, `main()`.
- `src/server.ts` — MCP `Server` setup, tool definitions, request routing.
- `src/config.ts` — YAML loading, env interpolation, Zod 4 parsing.
- `src/types.ts` — flat TypeScript interfaces and const-derived types.
- `src/secrets.ts` — secret resolution from env / secrets manager.
- `src/validator.ts` — Query Guard (AST + regex).
- `src/database.ts` — `mssql` pool and parameterized query execution.
- `src/audit.ts` — pino structured audit logger (metadata only).
- `src/rbac.ts` — role/schema/action checks.
- `src/rate-limiter.ts` — token-bucket per-user limiter.
- `src/guards.ts` — runtime type guards for `unknown` values.

Each module should have one public job; internal helpers stay private. No `any` in shared boundaries.

### 4. Configuration Management

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **YAML + Zod 4** (recommended) | Human-readable; matches PRD FR-24; strong runtime validation | Needs interpolation step before parsing | Low |
| **JSON + Zod 4** | Also strongly validated | Less readable for non-developers | Low |

Implementation notes:
- Load YAML with `js-yaml`.
- Interpolate `${VAR}` tokens from `process.env` before Zod parsing.
- Validate with the Zod 4 schema above; use `safeParse` and throw a clear, aggregated error.
- Treat loaded config as `Readonly<AppConfig>` so handlers cannot mutate it.

### 5. Security Layers

- **Whitelist**: schema/table/mode map (`read_only` / `read_write`) from config. Query Guard rejects any table not in the whitelist for the requested schema.
- **Query Guard**: parse SQL with `node-sql-parser` (transactsql dialect) and block:
  - `DROP`, `TRUNCATE`, `ALTER`, `CREATE` (DDL) — **all roles, including admin, in v1** (resolve PRD contradiction).
  - `DELETE` / `UPDATE` without a `WHERE` clause.
  - DML on `read_only` tables.
  - Suspicious patterns (multiple statements, comments with semicolons) as a defense-in-depth layer.
- **RBAC**:
  - `reader`: SELECT only, read-only tables.
  - `writer`: SELECT + INSERT/UPDATE/DELETE on `read_write` whitelist tables.
  - `admin`: any DML within whitelist; requires confirmation for write ops; **no DDL in v1**.
- **Parameterized queries**: force `mssql` `request.input()` for all values; reject SQL that contains literal values where parameters should be used. This is the primary injection defense; Query Guard is secondary.
- **Logging**: log timestamp, user, query text, tables touched, rows affected, success/error, duration; **never log result values or secrets**. Use `pino` with redaction on keys like `password`, `token`, `secret`.
- **Rate limiting**: token-bucket per user (default 30/min).
- **Limits**: max rows 1000 (append `TOP` or enforce in code), query timeout 30s.

### 6. Testing Strategy

| Layer | Tool | Notes |
|---|---|---|
| Unit | Vitest | Native TS support; mock `database.ts`, `config.ts`, and rate limiter |
| Integration | Docker Compose SQL Server | Spin up `mcr.microsoft.com/mssql/server`; run real queries against a test DB |
| Security | Vitest + static strings | Destructive query blocks, injection attempts, RBAC refusal, DDL rejection |
| Coverage | Vitest `--coverage` | Target >80% (NFR-05) |

Recommended workflow:
- `pnpm test` — unit tests with mocked DB.
- `pnpm test:integration` — requires Docker; tagged with `integration`.
- `pnpm test:security` — focused security cases.

### 7. Deployment

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **Docker (`node:22-slim`)** | Reproducible; no host Node needed | Optional per PRD | Low |
| **Local dev (`pnpm` + `tsx`)** | Fastest iteration | Requires Node LTS 20/22 installed | Low |

- Package manager: `pnpm` (recommended), `npm` fallback.
- Docker base: `node:22-slim`. `mssql`/`tedious` are pure JS, so no native build dependencies are needed.
- Local dev: `pnpm install` → `pnpm dev` (`tsx watch src/index.ts`) → `pnpm start` (node `dist/index.js` or `tsx src/index.ts`).

### 8. TypeScript Build

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **tsc + tsx** (recommended) | Familiar; separate type-check and emit; fast dev with `tsx` | Two-step build | Low |
| **tsup** | Single-file distribution; fast | Adds bundler complexity; not needed for v1 | Low-Medium |

Recommendation: `tsc` for type checking and emit to `dist/`, `tsx` for local development. Start simple; introduce `tsup` only when a distributable bundle is needed.

## Recommendation

1. **Transport**: Start with **stdio** (`@modelcontextprotocol/sdk`). It is the lowest-friction path for Claude Desktop/Cursor and matches the PRD's default client set. Abstract the transport choice behind a typed `Transport` value so SSE can be added later.
2. **Driver**: Use the **`mssql` driver** for SQL Server — standard, maintained, pooled, and supports parameter binding.
3. **Config**: Adopt **YAML + Zod 4** for configuration, mirroring the PRD example and providing strong validation. Apply Zod 4 API shapes (`z.email()`, `z.string().min(1)`, `{ error: "..." }`) and derive TS types with `z.infer`.
4. **TS conventions**: Apply const types, flat interfaces, no `any`, `import type`, utility types, and runtime type guards throughout the codebase.
5. **Query Guard**: Implement AST parsing with `node-sql-parser` (transactsql) for robust rule enforcement, with regex fallback for unsupported dialect constructs. Treat parameter binding as the primary injection defense.
6. **Build**: Use `tsc + tsx` locally; keep Docker optional with `node:22-slim`.
7. **Testing**: Use **Vitest** for unit tests and a Docker Compose SQL Server target for optional integration tests. Security cases should be explicit and run in CI.

## Risks

- **PRD contradiction**: section 1.3 says no DDL in v1 for any role, but FR-15 says admin can execute "any operation". Clarify: admin = any DML within whitelist, no DDL in v1.
- **FR-12 (block `SELECT *`)** is awkward to enforce reliably; propose replacing with row limits and large-table warnings.
- **FR-14** says "explicit LLM confirmation" but should be user confirmation (client prompt). The MCP server cannot confirm; it can only request confirmation via tool result text.
- **Section 6.2** mentions logging "result" but FR-23 forbids logging result data; enforce metadata-only logging and audit the logger.
- **NFR-03** needs confirmation: private Yhat repo, not open source.
- **Greenfield project**: no existing code to constrain design, so the next phase must scaffold the MVP and define the first slice carefully.
- **Zod 4 ecosystem**: some `@hookform/resolvers`-style packages may lag; for this server we only need `zod` itself, so the risk is minimal.
- **SQL parser coverage**: `node-sql-parser` supports TSQL but may misparse exotic SQL; keep a conservative fallback and test parser output against real SQL Server queries.

## Ready for Proposal

**Yes.** The next phase should be `sdd-propose` to create a scoped change proposal for the **Phase 1 MVP** (stdio MCP server, read-only SELECT, whitelist, Query Guard, audit logging). The PRD contradictions listed above should be flagged as questions to resolve before specification.
