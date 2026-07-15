# Delta Specs: yhat-mcp-defensive-install

## Domain: installation-portability (new)

### Requirement: Cross-platform install and packaging

The system MUST install and package the CLI cross-platform so it runs from any working directory.

**Acceptance Criteria:**

- Stable config dir is OS-specific; `YHAT_CONFIG_ROOT` overrides; `config/` and `.env` inside.
- Installers copy `dist/cli.cjs` and `keytar-*.node`, create the PATH shim, and update Windows PATH if missing.
- `package.json` ships `dist`; `tsup.config.ts` bundles `dotenv`; first run migrates repo config and `.env` if stable dir is empty.
- The working-tree `.env` `YHAT_DB_PASSWORD` is rotated and README is updated.

#### Scenario: Install

- GIVEN `dist/cli.cjs` and keytar `.node` files exist
- WHEN the installer runs on Linux/macOS or Windows
- THEN it copies assets to the stable dir, creates the platform shim, and updates PATH

#### Scenario: Migrate

- GIVEN no stable dir exists and repo-relative config and `.env` exist
- WHEN the CLI first runs
- THEN it copies both files to the stable dir and leaves stable files intact

### Cross-platform notes

- Linux/macOS: `~/.local/share/yhat-mcp` or `$XDG_DATA_HOME/yhat-mcp`, shim at `~/.local/bin/yhat-mcp`; Windows: `%LOCALAPPDATA%\\yhat-mcp`, shim at `%LOCALAPPDATA%\\yhat-mcp\\yhat-mcp.cmd`; keytar bindings are platform-specific.

## Domain: secret-resolution (new)

### Requirement: Keychain-backed database password

The system MUST store and read the DB password from the OS keychain, with an env fallback.

**Acceptance Criteria:**

- Setup stores the password in `keytar` under service `yhat-mcp`, account `YHAT_DB_PASSWORD`.
- Stable `.env` omits `YHAT_DB_PASSWORD`.
- `database.ts` reads keytar first, then env.
- Missing secret error guides user to run `yhat-mcp setup`.

#### Scenario: Happy

- GIVEN the user enters a password during setup
- WHEN setup completes
- THEN `keytar` contains the password and the stable `.env` has no `YHAT_DB_PASSWORD`

#### Scenario: Missing

- GIVEN keytar has no password and `YHAT_DB_PASSWORD` is unset
- WHEN the database connects
- THEN it throws an error instructing the user to run `yhat-mcp setup`

### Cross-platform notes

- `keytar` uses the OS credential store. The env fallback supports tests and CI.

## Domain: config-loader (delta)

### Requirement: Stable config path, env loading, and port coercion

The system MUST load config and `.env` from the stable config dir, support overrides, and coerce `database.port`.

**Acceptance Criteria:**

- `DEFAULT_CONFIG_PATH` is `<stable>/config/yhat-mcp-config.yaml`; `YHAT_CONFIG_PATH` overrides; `.env` loads with `override: false`.
- `database.port` coerced via `z.coerce.number()`.

#### Scenario: Happy

- GIVEN stable `.env` sets `YHAT_DB_PORT=1433` and config `port` is `"${YHAT_DB_PORT}"`
- WHEN the server loads
- THEN `database.port` is `1433` and `.env` was loaded from the stable config dir

#### Scenario: Missing env

- GIVEN the stable config dir has no `.env`
- WHEN the server loads
- THEN it continues with `process.env`

### Cross-platform notes

- Config paths use `node:path`; tests compare normalized paths. `.env` loading is identical on all platforms.

## Domain: mcp-server (delta)

### Requirement: Inline execution and portable OpenCode config

The system MUST run the server inline and install a portable OpenCode entry.

**Acceptance Criteria:**

- `yhat-mcp start` runs the server inline; the update check still runs.
- `src/index.ts` loads stable `.env` before other modules.
- `yhat-mcp install` writes `{"type":"local","command":["yhat-mcp","start"]}` with no `workingDirectory` or `environment`.

#### Scenario: Start

- GIVEN `yhat-mcp start` is invoked
- WHEN the command runs
- THEN it starts the server inline

#### Scenario: Install

- GIVEN `yhat-mcp install` runs
- WHEN OpenCode config is written
- THEN the entry has `type: local` and `command: ["yhat-mcp", "start"]`

### Cross-platform notes

- Inline start avoids shell/Windows quoting. The portable command relies on the PATH shim.

## Domain: audit-logging (delta)

### Requirement: Audit log directory resolution

The system MUST resolve relative `audit.logDir` against the stable config dir while preserving absolute paths.

**Acceptance Criteria:**

- A config value of `logs` becomes a stable-config subdir.
- Absolute paths remain unchanged.

#### Scenario: Resolution

- GIVEN `configRoot` is `/home/user/.local/share/yhat-mcp`
- WHEN `audit.logDir` is `logs` or `/var/log/yhat-mcp`
- THEN `logs` resolves under `configRoot` and `/var/log/yhat-mcp` remains unchanged

### Cross-platform notes

- Windows absolute paths are preserved; relative paths resolve against the stable config dir.
