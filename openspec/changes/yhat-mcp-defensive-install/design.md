# Design: Make yhat-mcp-server installation and OpenCode execution defensive and cross-platform

## Technical Approach

This change turns the project from a source-only, CWD-sensitive package into a self-contained, cross-platform CLI that can be installed via npm, release zip, or source. The implementation adds a stable user config directory, loads `.env` and config from that directory, migrates existing repo-relative files on first run, replaces the `npx tsx` spawn with inline server startup, resolves the database password from the OS keychain with an env fallback, coerces `database.port`, resolves `audit.logDir` against the stable config directory, and emits a portable OpenCode entry. The CLI bundle (`dist/cli.cjs`) ships with `dotenv` bundled and `keytar` handled as a native dependency that the installer places alongside the bundle.

## Architecture Decisions

### Decision: Centralized path resolution in `src/paths.ts`

**Choice**: Add a single `src/paths.ts` module that computes the stable config root, config directory, default config path, and `.env` path.
**Alternatives considered**: Spread `os.homedir()` / `LOCALAPPDATA` logic across every file that needs a path.
**Rationale**: Centralization prevents drift, makes cross-platform overrides explicit, and makes the path logic unit-testable.

### Decision: Stable config directory is the default, with `YHAT_CONFIG_ROOT` override

**Choice**: Default to `~/.local/share/yhat-mcp` (Linux/macOS), `$XDG_DATA_HOME/yhat-mcp` if set, and `%LOCALAPPDATA%\yhat-mcp` (Windows). Allow `YHAT_CONFIG_ROOT` to override the root.
**Alternatives considered**: Keep repo-relative config as default, use `~/.config`.
**Rationale**: User data directories are the conventional place for application data; `XDG_DATA_HOME` and `LOCALAPPDATA` are the standard OS conventions. `YHAT_CONFIG_ROOT` supports source development and tests.

### Decision: Keep `keytar` external to the bundle, ship native `.node` files

**Choice**: `tsup` will bundle `dotenv` and keep `keytar` as an external dependency. Installers copy the `keytar` package (or at least its `build/Release/*.node` files) into the install directory so the dynamic import resolves correctly.
**Alternatives considered**: Bundle keytar's JS and manually load `.node` with `process.dlopen`, or replace keytar with a pure-JS implementation.
**Rationale**: Native modules cannot be safely bundled into a JS blob. Keeping keytar external preserves its normal resolution, and the installer only needs to supply the native binary. The env fallback keeps the CLI working if keytar is missing.

### Decision: Inline `yhat-mcp start` instead of spawning `npx tsx`

**Choice**: `cmdStart()` calls `createServer().start()` directly in the same process.
**Alternatives considered**: Spawn a bundled `index.cjs` file.
**Rationale**: Inline execution avoids shell/Windows quoting issues, removes the `npx tsx` dependency at runtime, and makes the update check and server startup run in one process. The bundled CLI already contains both the CLI dispatcher and the server code.

### Decision: Migrate repo-relative config on first run

**Choice**: When a command discovers the stable config directory does not exist but repo-relative `config/yhat-mcp-config.yaml` and/or `.env` exist in `process.cwd()`, copy them to the stable directory. If a stable file already exists, back it up with a timestamp suffix before overwriting. If the copied `.env` contains `YHAT_DB_PASSWORD`, store it in keytar and rewrite the stable `.env` without it.
**Alternatives considered**: Always require manual setup, or copy without backup.
**Rationale**: This preserves the source-development workflow and protects existing user data with backups. Moving the password into keytar during migration prevents plaintext secrets from lingering in the stable directory.

### Decision: Coerce `database.port` after interpolation

**Choice**: Change the Zod schema for `database.port` from `z.number()` to `z.coerce.number().int().positive().max(65535)`.
**Alternatives considered**: Pre-process the YAML string before interpolation.
**Rationale**: Zod coercion runs after env interpolation, so a string like `"${YHAT_DB_PORT}"` becomes the interpolated string and then is coerced to a number. This is the minimal, schema-driven change.

## Implementation Details

### 1. File/module plan

| File | Action | Description |
|------|--------|-------------|
| `src/paths.ts` | Create | Cross-platform config root/config dir/default config/`.env` path resolution. |
| `src/env.ts` | Create | Thin wrapper around `dotenv.config` using `ENV_PATH` from `paths.ts` with `override: false`. |
| `src/keytar.ts` | Create | Async keytar loader with env fallback; used by `database.ts` and `cli.ts`. |
| `src/migrate.ts` | Create | First-run migration from repo-relative `config/` and `.env` to stable config dir. |
| `src/index.ts` | Modify | Load stable `.env` before any other imports via `src/env.ts`. |
| `src/cli.ts` | Modify | Load stable `.env` before other imports; replace `cmdStart` spawn with inline `createServer().start()`; write stable config via `paths.ts`; remove `YHAT_DB_PASSWORD` from `.env` output; emit portable OpenCode command. |
| `src/config.ts` | Modify | Import `DEFAULT_CONFIG_PATH` from `paths.ts`; coerce `database.port` with `z.coerce.number()`; resolve relative `audit.logDir` against config root. |
| `src/database.ts` | Modify | Resolve password from keytar first, then env variable; throw a setup-guiding error if both miss. |
| `src/audit.ts` | Modify | No direct path change, but receives an already-resolved absolute `logDir`. |
| `src/server.ts` | Modify | Ensure `config.audit.logDir` is resolved before creating the audit logger. |
| `install.sh` | Modify | Copy `dist/cli.cjs` and keytar native files; create `~/.local/bin/yhat-mcp` shim; update PATH. |
| `install.ps1` | Modify | Copy `dist/cli.cjs` and keytar native files; create `%LOCALAPPDATA%\yhat-mcp\yhat-mcp.cmd` shim; update user PATH. |
| `package.json` | Modify | Add `files: ["dist"]` (and any required runtime files); ensure `bin` points to `dist/cli.cjs`. |
| `tsup.config.ts` | Modify | Add `dotenv` to `noExternal`; keep `keytar` external; ensure `outDir` is `dist`. |
| `README.md` | Modify | Update install/config paths to stable directory; remove hardcoded `start-yhat-mcp.cmd` references. |
| `.env` | Modify | Rotate `YHAT_DB_PASSWORD` to a new value and remove it from the file (or mark it as obsolete). |
| `start-yhat-mcp.cmd` | Delete | Replaced by the portable Windows shim created by `install.ps1`. |

### 2. Data flow

```
User/OpenCode
     │
     ▼
[yhat-mcp start]  (dist/cli.cjs)
     │
     ├─► load stable .env via src/env.ts (override: false)
     │
     ├─► cmdStart()
     │       ├─► background checkForUpdate()
     │       └─► createServer().start()
     │
     ▼
[server.ts start]
     │
     ├─► loadConfigFile(DEFAULT_CONFIG_PATH, env)
     │       ├─► interpolate env tokens
     │       ├─► z.coerce.number() for database.port
     │       └─► resolve audit.logDir to absolute path under configRoot
     │
     ├─► createDatabaseClient(config.database, env)
     │       └─► resolve password:
     │               1. keytar.getPassword("yhat-mcp", "YHAT_DB_PASSWORD")
     │               2. env[YHAT_DB_PASSWORD]
     │               3. throw setup-guiding error
     │
     ├─► createAuditLogger(config.audit)  → logs under configRoot/logs
     │
     ├─► database.connect()
     │
     └─► register "yhat_query" MCP tool and connect stdio transport
```

### 3. Cross-platform path strategy

**Config root (`configRoot`)**

```ts
export function getConfigRoot(): string {
  if (process.env.YHAT_CONFIG_ROOT) return process.env.YHAT_CONFIG_ROOT;
  if (process.env.XDG_DATA_HOME && platform() !== "win32") {
    return join(process.env.XDG_DATA_HOME, "yhat-mcp");
  }
  if (platform() === "win32") {
    return join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? join(homedir(), "AppData", "Local"), "yhat-mcp");
  }
  return join(homedir(), ".local", "share", "yhat-mcp");
}
```

| OS | Default config root | Override env |
|----|---------------------|--------------|
| Linux | `~/.local/share/yhat-mcp` | `YHAT_CONFIG_ROOT`, `XDG_DATA_HOME` |
| macOS | `~/.local/share/yhat-mcp` | `YHAT_CONFIG_ROOT`, `XDG_DATA_HOME` |
| Windows | `%LOCALAPPDATA%\yhat-mcp` | `YHAT_CONFIG_ROOT`, `LOCALAPPDATA` |

**Derived paths**

```ts
export const CONFIG_ROOT = getConfigRoot();
export const CONFIG_DIR = join(CONFIG_ROOT, "config");
export const DEFAULT_CONFIG_PATH = join(CONFIG_DIR, "yhat-mcp-config.yaml");
export const ENV_PATH = join(CONFIG_ROOT, ".env");
```

**Shim paths**

- Linux/macOS: `~/.local/bin/yhat-mcp` (shell script).
- Windows: `%LOCALAPPDATA%\yhat-mcp\yhat-mcp.cmd`.

**OpenCode config path**

Keep existing resolution: `~/.config/opencode/opencode.json` on Linux/macOS, `%APPDATA%\opencode\opencode.json` on Windows. The `cli.ts` `resolveHome` helper remains; no change to OpenCode path logic.

### 4. Keytar integration design

A dedicated `src/keytar.ts` module isolates all keytar access and provides a graceful fallback when the native module is unavailable.

```ts
import type * as KeytarType from "keytar";

let keytar: typeof KeytarType | null = null;
let keytarLoaded = false;

async function loadKeytar(): Promise<typeof KeytarType | null> {
  if (keytarLoaded) return keytar;
  keytarLoaded = true;
  try {
    keytar = await import("keytar");
  } catch {
    keytar = null;
  }
  return keytar;
}

export async function getPassword(service: string, account: string): Promise<string | null> {
  const k = await loadKeytar();
  if (!k) return null;
  try {
    return await k.getPassword(service, account);
  } catch {
    return null;
  }
}

export async function setPassword(service: string, account: string, password: string): Promise<boolean> {
  const k = await loadKeytar();
  if (!k) return false;
  try {
    await k.setPassword(service, account, password);
    return true;
  } catch {
    return false;
  }
}

export async function deletePassword(service: string, account: string): Promise<boolean> {
  const k = await loadKeytar();
  if (!k) return false;
  try {
    return await k.deletePassword(service, account);
  } catch {
    return false;
  }
}
```

**Bundling and shipping**

- `tsup.config.ts` keeps `keytar` out of `noExternal` (i.e., it is external). The bundled `dist/cli.cjs` will `await import("keytar")` at runtime.
- For `npm install -g` and source installs, Node resolves `keytar` from `node_modules` as usual.
- For release-zip installs, the installer copies the `keytar` package (including `build/Release/keytar.node`) into `<installDir>/node_modules/keytar`. Because the CLI entry is at `<installDir>/cli.cjs`, Node resolves `import("keytar")` to `<installDir>/node_modules/keytar`.
- If the `.node` file is missing or the OS cannot load it, `loadKeytar()` returns `null`, and the env fallback (`YHAT_DB_PASSWORD`) is used. A warning is printed once on first keytar failure.

### 5. Migration strategy

`src/migrate.ts` runs before any command that needs stable config.

**Algorithm**

```ts
export async function migrateStableConfig(): Promise<void> {
  if (process.env.YHAT_CONFIG_PATH) return; // explicit override

  const stableConfigExists = await fileExists(DEFAULT_CONFIG_PATH);
  const stableEnvExists = await fileExists(ENV_PATH);

  if (stableConfigExists || stableEnvExists) return;

  const repoConfig = join(process.cwd(), "config", "yhat-mcp-config.yaml");
  const repoEnv = join(process.cwd(), ".env");
  const repoConfigExists = await fileExists(repoConfig);
  const repoEnvExists = await fileExists(repoEnv);

  if (!repoConfigExists && !repoEnvExists) return;

  await mkdir(CONFIG_DIR, { recursive: true });

  if (repoConfigExists) {
    await copyWithBackup(repoConfig, DEFAULT_CONFIG_PATH);
  }

  if (repoEnvExists) {
    const envVars = await readEnvFile(repoEnv);
    const password = envVars.YHAT_DB_PASSWORD;
    if (password) {
      await setPassword(KEYTAR_SERVICE, "YHAT_DB_PASSWORD", password);
      delete envVars.YHAT_DB_PASSWORD;
      console.log("[yhat-mcp] Migrated database password to system keychain.");
    }
    await writeEnvFile(ENV_PATH, envVars);
  }

  console.log(`[yhat-mcp] Migrated config to ${CONFIG_ROOT}.`);
}
```

**Backup logic**

- If the destination file already exists, rename it to `<name>.bak-<ISO8601>` before copying.
- This protects against accidental overwrites during future migrations or downgrades.

### 6. OpenCode config generation

`yhat-mcp install` writes the following JSON entry under `mcp.yhat-sql`:

```json
{
  "mcp": {
    "yhat-sql": {
      "type": "local",
      "command": ["yhat-mcp", "start"]
    }
  }
}
```

**Behavior**

- Read existing OpenCode config (or create a new one).
- If `mcp.yhat-sql` exists and `askOverwrite` is `true`, prompt for confirmation before overwriting.
- Write only `type` and `command`; no `workingDirectory`, no `environment`, no absolute paths.
- The portable command relies on the PATH shim created by the installer.

### 7. Build/CLI packaging

**`tsup.config.ts`**

```ts
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["cjs"],
  platform: "node",
  outDir: "dist",
  target: "node20",
  noExternal: ["mssql", "js-yaml", "dotenv"],
  external: ["keytar"],
  bundle: true,
  sourcemap: true,
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
```

**`package.json`**

```json
{
  "bin": { "yhat-mcp": "./dist/cli.cjs" },
  "files": ["dist"],
  "scripts": {
    "build:cli": "tsup"
  }
}
```

**Install scripts**

- `install.sh`:
  1. Verify Node.js 20+.
  2. Run `npm install` + `npm run build:cli` if `dist/cli.cjs` is missing.
  3. Create `~/.local/bin/yhat-mcp` shim:
     ```sh
     #!/bin/sh
     exec node "${HOME}/.local/share/yhat-mcp/cli.cjs" "$@"
     ```
  4. Copy `dist/cli.cjs` (and `.map`) to `~/.local/share/yhat-mcp/`.
  5. Copy `node_modules/keytar` to `~/.local/share/yhat-mcp/node_modules/keytar`.
  6. Append `~/.local/bin` to `~/.bashrc` if missing.
  7. Print PATH warning and next steps.

- `install.ps1`:
  1. Verify Node.js 20+.
  2. Copy `dist/cli.cjs` (and `.map`) to `%LOCALAPPDATA%\yhat-mcp\`.
  3. Copy `node_modules\keytar` to `%LOCALAPPDATA%\yhat-mcp\node_modules\keytar`.
  4. Create `%LOCALAPPDATA%\yhat-mcp\yhat-mcp.cmd`:
     ```cmd
     @echo off
     node "%~dp0\cli.cjs" %*
     ```
  5. Add `%LOCALAPPDATA%\yhat-mcp` to the user `Path` environment variable if missing.
  6. Print PATH warning and next steps.

### 8. Error handling and UX

| Situation | Error message / behavior |
|-----------|--------------------------|
| Stable config not found | `Config not found at <path>. Run 'yhat-mcp setup' or set YHAT_CONFIG_PATH.` |
| Stable `.env` missing | Continue with `process.env` only; no error. |
| Missing env variable referenced in config | `Missing environment variable "<name>" referenced at <path>` |
| `database.port` not a valid port | `database.port: Number must be between 1 and 65535` |
| Database password missing | `Database password not found in keychain or environment variable YHAT_DB_PASSWORD. Run 'yhat-mcp setup'.` |
| Keytar native module missing | Print `Warning: keychain unavailable; using YHAT_DB_PASSWORD if set.` once, then use env fallback. |
| Update check fails | Silent; do not block startup. |
| Migration overwrites existing file | Back up existing file to `.bak-<timestamp>` before copy. |

### 9. Test approach

Add the following test files under `tests/` and run with `npm test` (which resolves to `node --import tsx --test tests`):

| Test file | What it covers |
|-----------|----------------|
| `tests/paths.test.ts` | `getConfigRoot()` returns correct paths for Windows, Linux, macOS; respects `YHAT_CONFIG_ROOT`, `XDG_DATA_HOME`, `LOCALAPPDATA`. |
| `tests/config.test.ts` | `database.port` coerces from string to number after interpolation; `audit.logDir` resolves relative paths to config root; absolute paths are preserved. |
| `tests/migrate.test.ts` | Migration copies repo config and `.env` to stable dir; strips `YHAT_DB_PASSWORD` and stores it in keytar; backs up existing stable files. |
| `tests/keytar.test.ts` | `getPassword` returns env value when keytar is unavailable; returns keytar value when available; env overrides keytar. |
| `tests/audit.test.ts` | `createAuditLogger` creates logs under the resolved absolute `logDir`. |
| `tests/install.test.ts` | OpenCode config entry has `type: "local"` and `command: ["yhat-mcp", "start"]`. |

**Test helpers**

- Use `node:test` with `describe`/`it` and `node:assert/strict`.
- Create temporary directories with `fs.mkdtempSync` and set `YHAT_CONFIG_ROOT` to them.
- Mock keytar by injecting a fake `keytar` module through `NODE_OPTIONS` or by wrapping `src/keytar.ts` with a test-only loader.
- Reset `process.env` between tests to avoid cross-test contamination.

### 10. Security considerations

- **Plaintext password rotation**: The working-tree `.env` currently contains an exposed `YHAT_DB_PASSWORD`. Rotate this password on the SQL Server and update the repo `.env` to remove the value. The migration process will store the new password in keytar and write a stable `.env` without it.
- **Keychain as default**: `database.ts` reads keytar first and only falls back to `YHAT_DB_PASSWORD` for CI/tests. The fallback is logged at `warn` level once per process.
- **No secrets in OpenCode config**: The generated entry contains only `type` and `command`; no `environment`, no `workingDirectory`, no absolute paths that might leak a home directory.
- **Audit log isolation**: `audit.logDir` is resolved to an absolute path under the stable config directory, preventing OpenCode's CWD from influencing where logs are written.
- **Stable `.env` sanitization**: `yhat-mcp setup` and migration both write `.env` without `YHAT_DB_PASSWORD`. A helper `sanitizeEnvVars` removes any key matching `*PASSWORD*`, `*TOKEN*`, or `*SECRET*` before writing.
- **Backup safety**: Migration backs up existing stable files before overwriting, reducing the risk of accidental secret loss.

## Interfaces / Contracts

**New `src/paths.ts` exports**

```ts
export function getConfigRoot(): string;
export const CONFIG_ROOT: string;
export const CONFIG_DIR: string;
export const DEFAULT_CONFIG_PATH: string;
export const ENV_PATH: string;
```

**New `src/env.ts` exports**

```ts
export function loadEnv(): void;
```

**New `src/keytar.ts` exports**

```ts
export async function getPassword(service: string, account: string): Promise<string | null>;
export async function setPassword(service: string, account: string, password: string): Promise<boolean>;
export async function deletePassword(service: string, account: string): Promise<boolean>;
```

**New `src/migrate.ts` exports**

```ts
export async function migrateStableConfig(): Promise<void>;
```

**Modified `src/config.ts` behavior**

- `loadConfigFile(configPath, env, configRoot?)` accepts an optional `configRoot` parameter to resolve `audit.logDir`.
- `database.port` uses `z.coerce.number().int().positive().max(65535)`.

**Modified `src/database.ts` behavior**

- `resolveSecret` becomes async and tries keytar before env.

## Testing Strategy

| Layer | What to test | Approach |
|-------|-------------|----------|
| Unit | Path resolution, env interpolation, port coercion, migration backup logic, keytar fallback | `node --test` with temporary directories and env mocks |
| Integration | `loadConfigFile` → resolved `audit.logDir`, `createDatabaseClient` password resolution | Run against temporary config and a fake keytar module |
| Build | `npm run build:cli` produces `dist/cli.cjs` and source map | CI step; verify file exists |
| Packaging | `npm pack` includes `dist/`; release zip includes `dist/cli.cjs` and keytar `.node` | Run `npm pack --dry-run` and inspect tarball list |

## Migration / Rollout

1. Implement the design, add tests, and run `npm test`.
2. Rotate the exposed `YHAT_DB_PASSWORD` in the working-tree `.env` and on the SQL Server.
3. Run `npm run build:cli` and verify `dist/cli.cjs` works.
4. Run `npm pack --dry-run` to confirm `dist/` is included.
5. Update `README.md` to document the stable config directory and new install flow.
6. For existing users, the next `yhat-mcp start` or `yhat-mcp setup` will migrate their repo-relative config and `.env` to the stable directory and move the password into keytar.

## Open Questions

- None. The design is ready for task breakdown.

## Risks

| Risk | Mitigation |
|------|------------|
| Keytar native binary missing on the target OS | Env fallback keeps the CLI usable; install scripts ship the `.node` file for the platform. |
| Migration overwrites a user's hand-edited stable config | Backup with timestamp before any overwrite. |
| npm global install still fails if `dist/cli.cjs` is not in the published tarball | Add `files: ["dist"]` to `package.json` and verify with `npm pack --dry-run`. |
| Source developers expect `config/` and `.env` to keep working | First-run migration copies them; `YHAT_CONFIG_PATH` and `YHAT_CONFIG_ROOT` overrides remain supported. |
