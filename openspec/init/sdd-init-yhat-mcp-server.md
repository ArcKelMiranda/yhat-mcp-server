# SDD Init — yhat-mcp-server

> Detected: 2026-07-14
> Source: `package.json`, `tsconfig.json`, `tsup.config.ts`, `README.md`, source code in `src/`, `prd_extracted.txt`
> Phase executor: sdd-init

## Project Identity

- **Project name**: yhat-mcp-server
- **Display name**: Yhat MCP Server
- **Purpose**: Secure, auditable SQL Server access for AI assistants via Model Context Protocol (MCP)
- **Maturity**: Active implementation (TypeScript/Node.js scaffolded; not PRD-only)

## Detected Stack

| Layer | Value | Evidence |
|-------|-------|----------|
| Language | TypeScript 5.8+ | `package.json` devDependencies |
| Runtime | Node.js 20+ | `package.json` engines, `tsup.config.ts` target |
| Framework | `@modelcontextprotocol/server` v2 | `package.json` dependencies |
| Transport | stdio | `README.md` architecture, `config/yhat-mcp-config.yaml` |
| Database | SQL Server via `mssql` v12 | `package.json` dependencies |
| Configuration | `js-yaml` + `zod` v4 | `package.json` dependencies |
| Secrets | OS keychain via `keytar` | `package.json` dependencies, `README.md` |
| SQL Parsing | `node-sql-parser` v5 | `package.json` dependencies |
| Build | `tsup` (CJS bundle for CLI) | `tsup.config.ts` |
| Dev server | `tsx watch` | `package.json` scripts |

## Detected Conventions

- **Project layout**:
  ```
  yhat-mcp-server/
  ├── src/                  # TypeScript source
  │   ├── index.ts          # MCP server entry point
  │   ├── cli.ts            # CLI entry point
  │   ├── server.ts         # Server setup
  │   ├── config.ts         # Configuration loading
  │   ├── validator.ts      # Query Guard / SQL validation
  │   ├── whitelist.ts      # Whitelist auth
  │   ├── database.ts       # SQL Server connection layer
  │   ├── audit.ts          # Audit logging
  │   ├── row-limit.ts      # Row limit logic
  │   └── types.ts          # Shared types
  ├── config/               # Runtime config directory
  ├── tests/                # Test directory (currently empty)
  ├── logs/                 # Gitignored log output
  ├── dist/                 # Build output
  ├── releases/             # Release assets
  ├── package.json
  ├── tsconfig.json
  ├── tsup.config.ts
  └── README.md
  ```
- **Naming**: kebab-case file names (`row-limit.ts`), camelCase for modules/functions, PascalCase for types/interfaces.
- **Configuration**: YAML-driven, environment-variable placeholders for secrets (`${VAR}` style); secrets stored in OS keychain.
- **Module system**: ESM (`"type": "module"`), CJS bundle for CLI via `tsup`.
- **TypeScript strictness**: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `verbatimModuleSyntax: true`, `isolatedModules: true`.

## Detected Architecture Patterns

- **Layered security pipeline** (from `README.md` and source):
  1. Client MCP request via stdio
  2. Query Guard validates statement type (SELECT-only in current read-only mode)
  3. SQL Parser checks tables against whitelist
  4. Row Limit applies configurable max rows
  5. Database layer executes parameterized queries against SQL Server
  6. Audit Logger records metadata (no result data)
  7. Response to LLM
- **Core components**:
  - `validator.ts` — Query Guard
  - `whitelist.ts` — Schema/table whitelist
  - `database.ts` — SQL Server connection/execution
  - `audit.ts` — Audit logging
  - `config.ts` — YAML + env loading
  - `row-limit.ts` — Result set limits
- **Non-objectives for v1**: no DDL, no BI replacement, no custom GUI, no cloud lock-in.

## Testing Capabilities

See `openspec/config.yaml` `testing:` block and Engram topic `sdd/yhat-mcp-server/testing-capabilities` for the structured summary.

- **Test runner**: Node.js built-in test runner invoked via `node --import tsx --test tests`.
- **Current state**: runner configured, but `tests/` directory contains only `.gitkeep`; no test files yet.
- **Strict TDD**: `true` by default because a test runner exists; enforceable once tests are added.
- **Coverage/quality**: no coverage tool configured; TypeScript type check (`npm run lint`) serves as both linter and type checker; no formatter configured.

## Risks & Observations

- **CRITICAL**: `.env` file contains a real database password in plain text. The file is gitignored, but it is present in the working directory. Rotate this credential and move it to the OS keychain as intended.
- **WARNING**: `tests/` directory is empty; the test script currently fails with `ERR_MODULE_NOT_FOUND`. Add tests before relying on `npm test` in CI.
- **WARNING**: No code formatter (Prettier, Biome, dprint) or dedicated linter (ESLint, oxlint) is configured. Consider adding one for consistency.
- **SUGGESTION**: Security-focused project; establish a security test suite early (injection attempts, destructive query blocks, audit metadata verification).
- **SUGGESTION**: The PRD acceptance criteria require coverage >80% in Fase 3; plan test coverage tooling (`c8`, `node --test --experimental-test-coverage`, or a custom reporter) before that phase.
- **NOTE**: Previous OpenSpec/Engram init artifacts (under project name `MCP_SQLServer`) assumed a Python stack based on the PRD. This init reflects the actual TypeScript/Node.js implementation.

## Next Recommended Phase

`sdd-explore` or `sdd-new` — select the first change to drive through the SDD pipeline (likely adding the initial test suite or hardening the Query Guard/whitelist implementation).

## Artifact Store

- **OpenSpec**: `openspec/config.yaml` and this file (`openspec/init/sdd-init-yhat-mcp-server.md`) are the authoritative local artifacts.
- **Engram**: `sdd-init/yhat-mcp-server`, `sdd/yhat-mcp-server/testing-capabilities`, and `skill-registry` observations.
