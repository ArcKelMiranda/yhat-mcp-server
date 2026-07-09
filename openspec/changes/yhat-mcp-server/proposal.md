# Proposal: Yhat MCP Server — Phase 1 MVP

## Intent

Ship a read-only stdio MCP server that lets LLM clients query SQL Server through a whitelist, blocking destructive queries and auditing every query without logging secrets or results.

## Scope

### In Scope
- stdio MCP server via `@modelcontextprotocol/sdk`.
- SQL Server connection via `mssql`.
- Read-only `SELECT` on YAML-whitelisted tables, for all roles including admin.
- Hard row limit + large-table warning for `SELECT *`.
- Query Guard blocking DDL, DML, and writes.
- Metadata-only audit logging.
- Zod 4-validated YAML config.
- Vitest tests.

### Out of Scope
- Writes, admin DML, and any destructive queries.
- RBAC, admin confirmation, rate limiting.
- SSE transport; scaling.
- Client-side confirmation flows (future writes).
- Public/open-source release.

## Capabilities

### New Capabilities
- `mcp-server`: stdio server and tool routing.
- `sql-whitelist`: schema/table whitelist.
- `query-guard`: AST-based blocking of non-`SELECT` statements.
- `row-limit`: hard row limit and large-table warning for `SELECT`.
- `audit-logging`: metadata-only audit logs.
- `config-loader`: YAML + env interpolation with Zod 4.

### Modified Capabilities
- None.

## Approach

stdio + `@modelcontextprotocol/sdk`, `mssql`, `js-yaml` + Zod 4, `node-sql-parser` (transactsql), `tsc` + `tsx`. TypeScript strict patterns. Audit logs capture metadata only: frequency, tables, users, duration, row count, normalized query patterns.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `package.json` | New | Manifest. |
| `tsconfig.json` | New | TS config. |
| `src/server.ts` | New | Server. |
| `src/config.ts` | New | Loader. |
| `src/validator.ts` | New | Guard. |
| `src/database.ts` | New | DB. |
| `src/audit.ts` | New | Logger. |
| `src/types.ts` | New | Types. |
| `config/yhat-mcp-config.yaml` | New | Config. |
| `tests/` | New | Tests. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| TSQL parser gaps | Medium | Regex fallback + tests. |
| Destructive query bypass | Low | Block all non-`SELECT` + parameter binding. |
| Secret leak in logs | Low | No result logging; redact secrets. |
| Large-table `SELECT *` | Medium | Hard row limit + warning. |

## Rollback Plan

Stop the process, remove the client config, and revert package/config. Only audit logs persist.

## Dependencies

- Node.js 20+ LTS.
- SQL Server read-only account.
- YAML whitelist config.
- `YHAT_DB_PASSWORD` environment variable.

## Success Criteria

- [ ] Destructive queries blocked with clear error.
- [ ] `SELECT` on whitelist <2s for 1,000 rows.
- [ ] Non-whitelisted tables and non-`SELECT` statements rejected.
- [ ] Audit logs: metadata only, no secrets/results.
- [ ] Setup <15 minutes.
- [ ] Tests pass >80% coverage.

## Decisions Resolved

1. **Fase 1 read-only for all roles**: Phase 1 supports only `SELECT` for every role, including admin. No writes, no DML, no DDL, no admin override.
2. **`SELECT *`**: Replaced FR-12's "block `SELECT *`" with a hard row limit + large-table warning.
3. **Confirmation flow**: Future write operations require user confirmation in the MCP client; the server returns a prompt/approval request, not an LLM confirmation.
4. **Audit logging**: **Metadata only**. Never log query result data, PII, or financial data. Usage measurement is metadata-only (query frequency, tables queried, user activity, duration, rows returned, normalized query patterns).
5. **Repository privacy**: Private Yhat internal repository; not open source.
