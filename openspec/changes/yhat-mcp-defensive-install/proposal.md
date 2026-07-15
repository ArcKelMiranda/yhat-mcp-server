# Proposal: Make yhat-mcp-server installation and OpenCode execution defensive and cross-platform

## Intent

End users currently hit CWD-dependent `.env` loading, source-only `yhat-mcp start`, broken global-PATH config paths, and missing native assets in packaged installs. This proposal makes the package install and run reliably on Linux, Windows, and macOS for npm global, release-zip, and source development without manual OpenCode edits.

## Scope

### In Scope
- Stable, cross-platform user config directory (`~/.local/share/yhat-mcp` / `%LOCALAPPDATA%\yhat-mcp`).
- Load `.env` and default config from that directory.
- First-run migration from repo-relative `config/` and `.env`.
- Inline `yhat-mcp start` instead of spawning `npx tsx src/index.ts`.
- Portable OpenCode install config: `command: ["yhat-mcp", "start"]`.
- Keychain-backed password lookup with optional env override.
- Coerce `database.port` after environment interpolation.
- Resolve `audit.logDir` relative to the stable config directory.
- Fix installer scripts and npm package metadata so `dist/` and keytar native files ship.
- Rotate the exposed password in the working-tree `.env`.

### Out of Scope
- Changing the query security pipeline (Query Guard, SQL whitelist, row limits, audit redaction).
- New database drivers or MCP tools.
- Changes to the `yhat-mcp update` flow beyond installer asset handling.

## Capabilities

### New Capabilities
- `installation-portability`: Cross-platform install via npm, release zip, and source; PATH shim creation and native keytar asset handling.

### Modified Capabilities
- `config-loader`: Default config path comes from the stable config directory; `database.port` is coerced to a number after env interpolation.
- `mcp-server`: Server loads `.env` from the stable config directory; `yhat-mcp start` runs the server inline.
- `audit-logging`: `audit.logDir` is resolved relative to the stable config directory.
- `secret-resolution`: Database password is read from the OS keychain by default, with an environment variable override still allowed.

## Approach

Implement Approach B: a self-contained bundle. Add `src/paths.ts` to centralize config-directory resolution. Make `src/index.ts` and `src/cli.ts` load `dotenv` from that directory before importing other modules. Replace the `npx tsx` spawn in `src/cli.ts` with `createServer().start()`. Update `src/database.ts` to call `keytar.getPassword` for `passwordEnv`, falling back to the env variable. Remove `YHAT_DB_PASSWORD` from the `.env` written by setup. Coerce `database.port` in `src/config.ts`. Resolve `audit.logDir` against the stable config directory in `src/audit.ts`. Make `yhat-mcp install` emit `command: ["yhat-mcp", "start"]`. Update `tsup.config.ts` to bundle `dotenv`, `package.json` to include a `files` array, and `install.sh`/`install.ps1` to copy `dist/cli.cjs` plus keytar `.node` files and create a `yhat-mcp` PATH shim. On first run, migrate existing repo-relative config and `.env` to the stable directory.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/paths.ts` | New | Resolves stable user config directory across platforms. |
| `src/config.ts` | Modified | `DEFAULT_CONFIG_PATH` from `paths.ts`; port coercion after interpolation. |
| `src/index.ts` | Modified | Loads `dotenv` from stable config directory. |
| `src/cli.ts` | Modified | Loads `dotenv`; inline `start`; portable OpenCode command; writes `.env` without password. |
| `src/database.ts` | Modified | Resolves password from keytar with env fallback. |
| `src/audit.ts` | Modified | Resolves `logDir` relative to stable config directory. |
| `install.sh` | Modified | Copies `cli.cjs` and keytar `.node` files; creates PATH shim. |
| `install.ps1` | Modified | Copies `cli.cjs` and keytar `.node` files; creates `yhat-mcp` shim. |
| `package.json` | Modified | Adds `files` array; ensures `dist` ships. |
| `tsup.config.ts` | Modified | Bundles `dotenv`. |
| `.env` (repo) | Modified | Rotates exposed password. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Keytar native module missing on target OS | Med | Keep env-variable fallback; ship keytar `.node` files in installers. |
| Migration overwrites existing stable config | Low | Prompt or backup before copying repo-relative config. |
| npm global install still requires PATH refresh | Med | Install scripts append PATH and print a clear warning. |
| Source dev users expect repo-relative `.env` | Low | First-run migration copies existing repo `.env`/`config`; continue to support `YHAT_CONFIG_PATH` override. |

## Rollback Plan

1. Restore the previous OpenCode config entry (manual or via `yhat-mcp uninstall` then reinstall previous version).
2. Reinstall the prior npm package or extract the previous release zip.
3. Restore the previous `config/yhat-mcp-config.yaml` and `.env` from the backup created during migration.
4. If keytar path is broken, set `YHAT_DB_PASSWORD` directly and restart the server.

## Dependencies

- `keytar` native binaries must be available for the target platform or ship with the installer.
- Node.js 20+ must be installed.

## Success Criteria

- [ ] `yhat-mcp install` works on a clean Linux, Windows, and macOS machine without editing OpenCode config.
- [ ] OpenCode can start the server from any working directory and the correct `.env` is loaded.
- [ ] `database.port` accepts an interpolated string value and validates as a number.
- [ ] The password is not written to the stable `.env`; keytar fallback works.
- [ ] Audit logs are written under the stable config directory, not the OpenCode CWD.
- [ ] `npm pack` / release zip includes `dist/cli.cjs` and keytar native files.
- [ ] Source development still works with the existing repo config via migration or override.
- [ ] The exposed password in the working-tree `.env` is rotated and no longer used.
