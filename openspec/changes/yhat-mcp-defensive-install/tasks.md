# Tasks: Make yhat-mcp-server installation and OpenCode execution defensive and cross-platform

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~550-850 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 Foundation → PR 2 Runtime/Secrets/Installers → PR 3 Tests/Docs/Cleanup |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Stable paths/config + port/logDir resolution | PR 1 | Best first slice; standalone foundation |
| 2 | Secret resolution + inline start + OpenCode entry | PR 2 | Depends on Unit 1 |
| 3 | Migration + installers + packaging | PR 2 or PR 3 | Split if build risk grows |
| 4 | Tests/docs/cleanup | PR 3 | Follow after code is stable |

## Phase 1: Foundation / Path & Config

- [x] 1.1 Create `src/paths.ts` and `src/env.ts`; update `src/config.ts` to consume stable config/env paths. Verify `YHAT_CONFIG_ROOT`, `XDG_DATA_HOME`, and `LOCALAPPDATA` resolve correctly and `.env` loads with `override: false`.
- [x] 1.2 Update `src/config.ts` to coerce `database.port` and resolve relative `audit.logDir` against the stable config root. Verify interpolated `"${YHAT_DB_PORT}"` becomes a number and absolute audit paths stay unchanged.
- [x] 1.3 Add `tests/paths.test.ts` and `tests/config.test.ts` for normalized path behavior and env interpolation. Verify `node --import tsx --test tests` passes for the new cases.

## Phase 2: Core Runtime / Secrets

- [x] 2.1 Add `src/keytar.ts` and update `src/database.ts` to read keytar first, then `YHAT_DB_PASSWORD`, with a setup-guiding error on miss. Verify keytar-hit, env-fallback, and missing-secret tests.
- [x] 2.2 Load stable `.env` before other imports in `src/index.ts` and `src/cli.ts`. Verify server startup sees stable env values from any working directory.
- [x] 2.3 Replace `cmdStart()` spawn in `src/cli.ts` with inline `createServer().start()` and keep the update check. Verify `yhat-mcp start` no longer shells out to `npx tsx`.
- [x] 2.4 Update `src/cli.ts` `install` to write `{"type":"local","command":["yhat-mcp","start"]}` and omit `YHAT_DB_PASSWORD` from `.env`. Verify OpenCode JSON shape and sanitized env output.

## Phase 3: Migration / Installers / Packaging

- [x] 3.1 Add `src/migrate.ts` and run it before config load in startup/setup flows. Verify repo-relative `config/` and `.env` copy to the stable dir, backups are created, and stable files remain intact.
- [x] 3.2 Update `install.sh` and `install.ps1` to copy `dist/cli.cjs` plus keytar native assets and create PATH shims. Verify Linux/macOS and Windows shim paths are emitted correctly.
- [x] 3.3 Update `package.json`, `tsup.config.ts`, `README.md`, rotate `.env`, and delete `start-yhat-mcp.cmd`. Verify `npm run build:cli`, `npm pack --dry-run`, and docs reflect stable paths and the removed plaintext secret.

## Phase 4: Verification / Regression Coverage

- [x] 4.1 Add migration, keytar fallback, install-config, and audit-path tests under `tests/`. Verify `node --import tsx --test tests` covers migration, OpenCode config, and audit log resolution.
- [x] 4.2 Add startup and secret-handling regressions. Verify no test writes `YHAT_DB_PASSWORD` into the stable `.env` and audit logs resolve under the config root.
