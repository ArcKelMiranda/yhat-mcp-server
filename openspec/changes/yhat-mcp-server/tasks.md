# Tasks: Yhat MCP Server — Phase 1 MVP

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~700–1100 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 bootstrap → PR 2 config/security → PR 3 db/audit/server → PR 4 tests/docs |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

## Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Repo bootstrap + compile path | PR 1 | Smallest safe slice; no MCP behavior yet. |
| 2 | Config + security foundation | PR 2 | Blocks unsafe SQL before execution. |
| 3 | DB + audit + server wiring | PR 3 | End-to-end read-only tool path. |
| 4 | Tests + docs | PR 4 | Keep verification with the behavior it covers. |

## Phase 1: Foundation

- [ ] 1.1 Create `package.json`, `tsconfig.json`, and base folders (`src/`, `config/`, `tests/`) with `dev`, `build`, `test`, and `lint` scripts.
- [ ] 1.2 Add `src/index.ts`, `src/types.ts`, and a minimal `src/server.ts` scaffold that compiles and shuts down cleanly.

## Phase 2: Config + Query Security

- [ ] 2.1 Implement `src/config.ts` with YAML parsing, `${VAR}` env interpolation, and Zod 4 validation; add `config/yhat-mcp-config.yaml`.
- [ ] 2.2 Implement `src/validator.ts`, `src/whitelist.ts`, and `src/row-limit.ts` for AST-based SELECT-only checks, whitelist enforcement, and SELECT-only row caps/warnings.

## Phase 3: DB + Audit + MCP Wiring

- [ ] 3.1 Implement `src/database.ts` for `mssql` pool lifecycle and parameterized SELECT execution with shaped results.
- [ ] 3.2 Implement `src/audit.ts` for metadata-only logs, redaction, rotation settings, and usage-metric hooks.
- [ ] 3.3 Wire `src/server.ts` tool registration/routing and graceful shutdown across config, guard, whitelist, DB, and audit.

## Phase 4: Tests + Docs

- [ ] 4.1 Add Vitest unit/security tests for config validation, guard/whitelist rejects, row-limit enforcement, and audit redaction.
- [ ] 4.2 Add integration-test scaffolding for SQL Server plus `README.md` setup steps and a sample config.

## Blockers / Open Questions

- Confirm the chain strategy before apply; the forecast is high-risk.
- `openspec/config.yaml` still reflects a Python/pytest stack, which conflicts with this TypeScript/Node.js change and should be treated as stale metadata.
