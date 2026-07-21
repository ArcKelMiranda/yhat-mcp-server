import { createInterface } from "node:readline";
import { readFile, writeFile, mkdir, access, constants } from "node:fs/promises";
import { join, dirname } from "node:path";
import { load as loadYaml } from "js-yaml";
import sql from "mssql";

import { prepareRuntimeEnvironment } from "./runtime.js";
import { loadConfigFile } from "./config.js";
import { runDoctorCore, renderReport, type DoctorDependencies } from "./doctor.js";
import { migrateStableConfig } from "./migrate.js";
import { saveDatabasePassword, loadDatabasePassword, saveSecret, loadSecret } from "./keytar.js";
import { buildOpenCodeConfig } from "./opencode.js";
import { createServer } from "./server.js";
import { runStartCommand } from "./start.js";
import { getDefaultConfigPath, getEnvPath } from "./paths.js";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

function getStableConfigPath(): string {
  return getDefaultConfigPath();
}

function getStableConfigDir(): string {
  return dirname(getStableConfigPath());
}

function getStableEnvPath(): string {
  return getEnvPath();
}

function getInstallDir(): string {
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA ?? join(process.env.APPDATA ?? "", "yhat-mcp");
  }
  return join(process.env.HOME ?? "", ".local", "share", "yhat-mcp");
}

function resolveHome(filepath: string): string {
  if (filepath.startsWith("~/")) {
    return join(process.env.HOME ?? process.env.USERPROFILE ?? "", filepath.slice(2));
  }
  return filepath;
}

const OPENCODE_CONFIG_PATH = resolveHome("~/.config/opencode/opencode.json");
const REPO_OWNER = "ArcKelMiranda";
const REPO_NAME = "yhat-mcp-server";
const GITHUB_API_RELEASES = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

// ─────────────────────────────────────────────────────────────
// .env file helpers
// ─────────────────────────────────────────────────────────────

interface EnvVars {
  [key: string]: string | undefined;
}

function maskEnvVar(name: string, value: string | undefined): string {
  // Kept byte-identical with src/doctor.ts:208; extraction is intentionally deferred.
  if (value === undefined || value === "") return `${name}=(not set)`;
  const lower = name.toLowerCase();
  if (lower.includes("password") || lower.includes("token") || lower.includes("secret")) {
    return `${name}=*** (set)`;
  }
  return `${name}=${value}`;
}

async function readEnvFile(path: string): Promise<EnvVars> {
  try {
    const content = await readFile(path, "utf8");
    const vars: EnvVars = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      vars[key] = value;
    }
    return vars;
  } catch {
    return {};
  }
}

async function writeEnvFile(path: string, vars: EnvVars): Promise<void> {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined && value !== "") {
      lines.push(`${key}=${value}`);
    }
  }
  await writeFile(path, lines.join("\n") + "\n", "utf8");
}

// ─────────────────────────────────────────────────────────────
// Version helpers
// ─────────────────────────────────────────────────────────────

async function getLocalVersion(): Promise<string> {
  try {
    const installDir = getInstallDir();
    return (await readFile(join(installDir, "version.txt"), "utf8")).trim();
  } catch {
    const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { version: string };
    return pkg.version;
  }
}

function compareVersions(a: string, b: string): number {
  const partsA = a.replace(/^v/, "").split(".").map(Number);
  const partsB = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const pa = partsA[i] ?? 0;
    const pb = partsB[i] ?? 0;
    if (pa !== pb) return pa - pb;
  }
  return 0;
}

interface UpdateCheck {
  hasUpdate: boolean;
  latestVersion: string;
  localVersion: string;
  downloadUrl?: string | undefined;
  assetName?: string | undefined;
}

async function checkForUpdate(): Promise<UpdateCheck> {
  const localVersion = await getLocalVersion();
  const token = await loadSecret("YHAT_GITHUB_TOKEN");

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let latestVersion = localVersion;
  let downloadUrl: string | undefined;
  let assetName: string | undefined;

  try {
    const response = await fetch(GITHUB_API_RELEASES, { headers });
    if (response.ok) {
      const data = (await response.json()) as {
        tag_name: string;
        assets: Array<{ name: string; browser_download_url: string }>;
      };
      latestVersion = data.tag_name;

      const platform = process.platform;
      const ext = platform === "win32" ? ".zip" : ".tar.gz";
      const assetPattern = `${platform}${ext}`;
      const asset = data.assets.find((a) => a.name.endsWith(assetPattern));
      if (asset) {
        downloadUrl = asset.browser_download_url;
        assetName = asset.name;
      }
    }
  } catch {
    // Network error — silently skip update check
  }

  return {
    hasUpdate: compareVersions(latestVersion, localVersion) > 0,
    latestVersion,
    localVersion,
    downloadUrl,
    assetName,
  };
}

// ─────────────────────────────────────────────────────────────
// Prompt helpers
// ─────────────────────────────────────────────────────────────

function createPrompt(): ReturnType<typeof createInterface> {
  return createInterface({ input: process.stdin, output: process.stdout });
}

async function ask(query: string, prompt: ReturnType<typeof createInterface>): Promise<string> {
  return new Promise<string>((resolve) => {
    prompt.question(`${query}: `, (answer) => resolve(answer.trim()));
  });
}

async function confirm(message: string, prompt: ReturnType<typeof createInterface>): Promise<boolean> {
  const answer = await ask(`${message} (y/N)`, prompt);
  return answer.toLowerCase() === "y";
}

function closePrompt(prompt: ReturnType<typeof createInterface>): void {
  prompt.close();
}

// ─────────────────────────────────────────────────────────────
// Database connection test
// ─────────────────────────────────────────────────────────────

async function testConnection(params: {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}): Promise<{ success: true } | { success: false; error: string }> {
  const pool = new sql.ConnectionPool({
    server: params.host,
    database: params.name,
    user: params.user,
    password: params.password,
    port: params.port,
    options: {
      encrypt: params.encrypt,
      trustServerCertificate: params.trustServerCertificate,
    },
  });

  try {
    await pool.connect();
    await pool.close();
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────────────────────
// Setup wizard
// ─────────────────────────────────────────────────────────────

async function cmdSetup(): Promise<void> {
  await migrateStableConfig({ cwd: process.cwd() });
  const prompt = createPrompt();

  try {
    console.log("\n=== yhat-mcp setup wizard ===\n");
    console.log("Press Ctrl+C to abort at any time.\n");

    // Detect existing .env
    let existingEnv: EnvVars = {};
    let envExists = false;
    try {
      await access(getStableEnvPath(), constants.F_OK);
      existingEnv = await readEnvFile(getStableEnvPath());
      envExists = Object.keys(existingEnv).length > 0;
    } catch {
      envExists = false;
    }

    const prefix = "YHAT";

    if (envExists) {
      console.log("Found existing .env file:");
      for (const [key, value] of Object.entries(existingEnv)) {
        if (key.startsWith(prefix)) {
          console.log(`  ${maskEnvVar(key, value)}`);
        }
      }
      console.log("");
    }

    const reuse = envExists ? await confirm("Use existing .env values? (Y/n)", prompt) : false;
    let host: string;
    let port: number;
    let name: string;
    let user: string;
    let password: string;
    let encrypt: boolean;
    let trustServerCertificate: boolean;

    if (reuse && envExists) {
      host = existingEnv[`${prefix}_DB_HOST`] ?? "";
      port = parseInt(existingEnv[`${prefix}_DB_PORT`] ?? "1433", 10);
      name = existingEnv[`${prefix}_DB_NAME`] ?? "";
      user = existingEnv[`${prefix}_DB_USER`] ?? "";
      encrypt = (existingEnv[`${prefix}_DB_ENCRYPT`] ?? "true").toLowerCase() !== "false";
      trustServerCertificate = (existingEnv[`${prefix}_DB_TRUST_CERT`] ?? "false").toLowerCase() === "true";
      const storedPassword = await loadDatabasePassword("YHAT_DB_PASSWORD");
      password = storedPassword ?? "";

      if (!host || !name || !user || !password) {
        console.log("\nSome .env values are missing. Please re-enter:");
        host = host || (await ask("SQL Server host", prompt));
        port = port || parseInt(await ask("SQL Server port (default 1433)", prompt).then((v) => v || "1433"), 10);
        name = name || (await ask("Database name", prompt));
        user = user || (await ask("Database user", prompt));
        password = password || (await ask("Database password", prompt));
      } else {
      console.log("\nUsing existing connection values and keychain password.\n");
      }
    } else {
      host = await ask("SQL Server host", prompt);
      const portStr = await ask("SQL Server port (default 1433)", prompt);
      port = portStr.trim() === "" ? 1433 : parseInt(portStr, 10);
      name = await ask("Database name", prompt);
      user = await ask("Database user", prompt);
      password = await ask("Database password", prompt);
      const encryptAnswer = await ask("Use TLS encryption? (Y/n)", prompt);
      encrypt = encryptAnswer.toLowerCase() !== "n";
      const trustAnswer = await ask("Trust server certificate? (y/N)", prompt);
      trustServerCertificate = trustAnswer.toLowerCase() === "y";
    }

    console.log("\n--- Whitelist configuration ---");
    console.log("Enter schema/table pairs to whitelist for read access.");
    console.log("Press Enter on empty schema to finish adding schemas.\n");

    const whitelist: Array<{ schema: string; tables: string[]; mode: "read_only" }> = [];

    while (true) {
      const schema = await ask("Schema name (or empty to finish)", prompt);

      if (schema.trim() === "") {
        break;
      }

      const tables: string[] = [];

      while (true) {
        const table = await ask(`  Table in "${schema}" (or empty to next schema)`, prompt);

        if (table.trim() === "") {
          break;
        }

        tables.push(table.trim());
      }

      if (tables.length > 0) {
        whitelist.push({ schema: schema.trim(), tables, mode: "read_only" });
      }
    }

    if (whitelist.length === 0) {
      console.log("No whitelist entries. Aborting.");
      return;
    }

    console.log("\n--- Testing connection ---");
    const result = await testConnection({ host, port, name, user, password, encrypt, trustServerCertificate });

    if (!result.success) {
      console.error(`\nConnection failed: ${result.error}`);
      console.error("Config was NOT written. Please fix and run setup again.");
      return;
    }

    console.log("Connection successful!");

    // Save password to keytar
    const saved = await saveDatabasePassword(password);
    if (!saved) {
      console.error("\nWarning: Could not save password to keychain. Falling back to YHAT_DB_PASSWORD in the stable .env file.");
    }

    // Ask for GitHub token
    const storedToken = await loadSecret("YHAT_GITHUB_TOKEN");
    let githubToken = storedToken ?? "";
    const tokenAnswer = await ask(
      `\nGitHub token for auto-update (leave empty to skip, current: ${storedToken ? "*** (set)" : "(not set)"})`,
      prompt,
    );
    if (tokenAnswer !== "") {
      githubToken = tokenAnswer;
      await saveSecret("YHAT_GITHUB_TOKEN", githubToken);
    } else if (!storedToken) {
      // No token provided and none stored — that's fine
    }

    // Write non-sensitive vars to .env
    const envVars: EnvVars = {
      [`${prefix}_DB_HOST`]: host,
      [`${prefix}_DB_PORT`]: String(port),
      [`${prefix}_DB_NAME`]: name,
      [`${prefix}_DB_USER`]: user,
      [`${prefix}_DB_ENCRYPT`]: String(encrypt),
      [`${prefix}_DB_TRUST_CERT`]: String(trustServerCertificate),
    };
    if (!saved) {
      envVars[`${prefix}_DB_PASSWORD`] = password;
    }
    await mkdir(getStableConfigDir(), { recursive: true });
    await writeEnvFile(getStableEnvPath(), envVars);

    const config: Record<string, unknown> = {
      server: { name: "yhat-mcp-server", transport: "stdio" },
      database: {
        host: `\${${prefix}_DB_HOST}`,
        port,
        name: `\${${prefix}_DB_NAME}`,
        user: `\${${prefix}_DB_USER}`,
        passwordEnv: `${prefix}_DB_PASSWORD`,
        encrypt,
        trustServerCertificate,
      },
      whitelist,
      limits: {
        maxRows: 1000,
        queryTimeoutSeconds: 30,
        largeTableColumnThreshold: 25,
        largeTableRowThreshold: 100000,
      },
      audit: {
        logDir: "logs",
        maxSizeMb: 50,
        maxAgeDays: 30,
        logLevel: "info",
      },
    };

    const yamlContent = dumpYaml(config, { lineWidth: 120 });
    await writeFile(getStableConfigPath(), yamlContent, "utf8");

    console.log(`\nConfig written to: ${getStableConfigPath()}`);
    console.log("Non-sensitive vars written to: " + getStableEnvPath());
    console.log("\nCredentials are stored in your system keychain.");
    console.log(`\n${prefix}_DB_PASSWORD is read from keychain (service: yhat-mcp).`);

    const doInstall = await confirm("\nInstall MCP server in OpenCode config?", prompt);

    if (doInstall) {
      await cmdInstall(false);
    } else {
      console.log("\nTo install later, run: yhat-mcp install");
    }
  } finally {
    closePrompt(prompt);
  }
}

function dumpYaml(data: unknown, options?: { lineWidth?: number }): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const YAML = require("js-yaml") as { dump: (d: unknown, o?: { lineWidth?: number }) => string };
  return YAML.dump(data, options);
}

// ─────────────────────────────────────────────────────────────
// OpenCode config helpers
// ─────────────────────────────────────────────────────────────

interface OpenCodeConfig {
  mcp?: Record<string, unknown>;
}

async function readOpenCodeConfig(): Promise<OpenCodeConfig | null> {
  try {
    const content = await readFile(OPENCODE_CONFIG_PATH, "utf8");
    return JSON.parse(content) as OpenCodeConfig;
  } catch {
    return null;
  }
}

async function writeOpenCodeConfig(config: OpenCodeConfig): Promise<void> {
  const dir = dirname(OPENCODE_CONFIG_PATH);
  await mkdir(dir, { recursive: true });
  await writeFile(OPENCODE_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

// ─────────────────────────────────────────────────────────────
// Install
// ─────────────────────────────────────────────────────────────

async function cmdInstall(askOverwrite = true): Promise<void> {
  const prompt = createPrompt();

  try {
    const opencodeConfig = await readOpenCodeConfig();
    const serverName = "yhat-sql";

    if (opencodeConfig === null) {
      const newConfig: OpenCodeConfig = buildOpenCodeConfig(null, serverName);
      await writeOpenCodeConfig(newConfig);
      console.log(`\nInstalled "${serverName}" in ${OPENCODE_CONFIG_PATH}`);
      return;
    }

    const existing = opencodeConfig.mcp?.[serverName];

    if (existing !== undefined) {
      if (askOverwrite) {
        const overwrite = await confirm(`\n"${serverName}" already exists. Overwrite?`, prompt);

        if (!overwrite) {
          console.log("Aborted.");
          return;
        }
      }
    }

    const updatedConfig: OpenCodeConfig = buildOpenCodeConfig(opencodeConfig, serverName);

    await writeOpenCodeConfig(updatedConfig);
    console.log(`\n"${serverName}" installed in ${OPENCODE_CONFIG_PATH}`);
  } finally {
    closePrompt(prompt);
  }
}

// ─────────────────────────────────────────────────────────────
// Uninstall
// ─────────────────────────────────────────────────────────────

async function cmdUninstall(): Promise<void> {
  const prompt = createPrompt();

  try {
    const opencodeConfig = await readOpenCodeConfig();
    const serverName = "yhat-sql";

    if (opencodeConfig === null || opencodeConfig.mcp?.[serverName] === undefined) {
      console.log(`"${serverName}" is not installed.`);
      return;
    }

    const proceed = await confirm(`\nRemove "${serverName}" from OpenCode config?`, prompt);

    if (!proceed) {
      console.log("Aborted.");
      return;
    }

    const updatedMcp = { ...opencodeConfig.mcp };
    delete updatedMcp[serverName];

    await writeOpenCodeConfig({ ...opencodeConfig, mcp: updatedMcp });
    console.log(`"${serverName}" removed from ${OPENCODE_CONFIG_PATH}`);
  } finally {
    closePrompt(prompt);
  }
}

// ─────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────

async function cmdUpdate(): Promise<void> {
  const prompt = createPrompt();

  try {
    console.log("\n=== yhat-mcp update ===\n");

    const update = await checkForUpdate();

    if (!update.hasUpdate) {
      console.log(`You're on the latest version: ${update.localVersion}`);
      return;
    }

    console.log(`A new version is available: ${update.latestVersion} (you have ${update.localVersion})`);
    console.log("");

    const proceed = await confirm("Download and install the update?", prompt);

    if (!proceed) {
      console.log("Update cancelled.");
      return;
    }

    if (!update.downloadUrl) {
      console.error("No compatible download found for this platform.");
      return;
    }

    console.log(`\nDownloading ${update.assetName}...`);

    const installDir = getInstallDir();
    await mkdir(installDir, { recursive: true });

    const response = await fetch(update.downloadUrl);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const platform = process.platform;
    const extractDir = join(installDir, "update-temp");

    if (platform === "win32") {
      // For Windows, just unzip
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const AdmZip = require("adm-zip") as { new (buf: Buffer): { extractAllTo: (p: string) => void } };
      const buf = Buffer.from(await response.arrayBuffer());
      const zip = new AdmZip(buf);
      await mkdir(extractDir, { recursive: true });
      zip.extractAllTo(extractDir);
    } else {
      // For Unix, extract tar.gz
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const tar = require("tar") as { x: (opts: { C: string; file: string }) => Promise<void> };
      const buf = Buffer.from(await response.arrayBuffer());
      await mkdir(extractDir, { recursive: true });
      // Write to temp file first
      const tmpPath = join(extractDir, "download.tar.gz");
      await writeFile(tmpPath, buf);
      await tar.x({ C: extractDir, file: tmpPath });
    }

    // Write version file
    await writeFile(join(installDir, "version.txt"), update.latestVersion, "utf8");

    console.log(`\nUpdated to ${update.latestVersion}!`);
    console.log(`Installed to: ${installDir}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nUpdate failed: ${message}`);
  } finally {
    closePrompt(prompt);
  }
}

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────

async function cmdStart(): Promise<void> {
  prepareRuntimeEnvironment();
  await migrateStableConfig({ cwd: process.cwd() });

  await runStartCommand({
    createServer,
    checkForUpdate,
    stderr: process.stderr,
  });
}

// ─────────────────────────────────────────────────────────────
// Config editor
// ─────────────────────────────────────────────────────────────

async function cmdConfig(): Promise<void> {
  const prompt = createPrompt();

  try {
    const content = await readFile(getStableConfigPath(), "utf8");
    const config = loadYaml(content) as Record<string, unknown>;
    const whitelist = (config["whitelist"] as Array<Record<string, unknown>>) ?? [];

    console.log("\n=== Whitelist editor ===\n");
    console.log(
      `Current schemas: ${
        whitelist.map((e) => String(e["schema"])).join(", ") || "(none)"
      }\n`,
    );

    const action = await ask(
      "Choose: list | add-schema | remove-schema | add-table | remove-table",
      prompt,
    );

    switch (action.trim().toLowerCase()) {
      case "list": {
        console.log("\nWhitelist:\n");
        for (const entry of whitelist) {
          console.log(`  ${String(entry["schema"])}: ${((entry["tables"] as string[]) ?? []).join(", ")}`);
        }
        break;
      }

      case "add-schema": {
        const schema = await ask("New schema name", prompt);

        if (!schema.trim()) {
          console.log("Schema name cannot be empty.");
          break;
        }

        const tables: string[] = [];

        while (true) {
          const table = await ask(`  Table in "${schema}" (empty to finish)`, prompt);

          if (table.trim() === "") {
            break;
          }

          tables.push(table.trim());
        }

        if (tables.length === 0) {
          console.log("No tables added. Schema not added.");
          break;
        }

        whitelist.push({ schema: schema.trim(), tables, mode: "read_only" });
        config["whitelist"] = whitelist;
        await writeFile(getStableConfigPath(), dumpYaml(config, { lineWidth: 120 }), "utf8");
        console.log(`Schema "${schema.trim()}" added.`);
        break;
      }

      case "remove-schema": {
        const schema = await ask("Schema to remove", prompt);
        const idx = whitelist.findIndex((e) => String(e["schema"]) === schema.trim());

        if (idx === -1) {
          console.log(`Schema "${schema}" not found.`);
          break;
        }

        whitelist.splice(idx, 1);
        config["whitelist"] = whitelist;
        await writeFile(getStableConfigPath(), dumpYaml(config, { lineWidth: 120 }), "utf8");
        console.log(`Schema "${schema.trim()}" removed.`);
        break;
      }

      case "add-table": {
        const schema = await ask("Schema", prompt);
        const entry = whitelist.find((e) => String(e["schema"]) === schema.trim());

        if (!entry) {
          console.log(`Schema "${schema}" not found in whitelist.`);
          break;
        }

        const table = await ask("Table to add", prompt);

        if (!table.trim()) {
          console.log("Table name cannot be empty.");
          break;
        }

        const tables = entry["tables"] as string[];
        if (!tables.includes(table.trim())) {
          tables.push(table.trim());
        }

        await writeFile(getStableConfigPath(), dumpYaml(config, { lineWidth: 120 }), "utf8");
        console.log(`Table "${table.trim()}" added to "${schema.trim()}".`);
        break;
      }

      case "remove-table": {
        const schema = await ask("Schema", prompt);
        const entry = whitelist.find((e) => String(e["schema"]) === schema.trim());

        if (!entry) {
          console.log(`Schema "${schema}" not found.`);
          break;
        }

        const table = await ask("Table to remove", prompt);
        const tables = entry["tables"] as string[];
        const idx = tables.indexOf(table.trim());

        if (idx === -1) {
          console.log(`Table "${table}" not found in schema "${schema}".`);
          break;
        }

        tables.splice(idx, 1);

        if (tables.length === 0) {
          const schemaIdx = whitelist.findIndex((e) => String(e["schema"]) === schema.trim());
          if (schemaIdx !== -1) {
            whitelist.splice(schemaIdx, 1);
          }
        }

        config["whitelist"] = whitelist;
        await writeFile(getStableConfigPath(), dumpYaml(config, { lineWidth: 120 }), "utf8");
        console.log(`Table "${table.trim()}" removed.`);
        break;
      }

      default:
        console.log(
          `Unknown action: "${action}". Try: list, add-schema, remove-schema, add-table, remove-table`,
        );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`Config file not found: ${getStableConfigPath()}`);
      console.error("Run 'yhat-mcp setup' first.");
    } else {
      throw error;
    }
  } finally {
    closePrompt(prompt);
  }
}

// ─────────────────────────────────────────────────────────────
// Main dispatcher
// ─────────────────────────────────────────────────────────────

const action = process.argv[2] ?? "help";

void (async (): Promise<void> => {
  prepareRuntimeEnvironment();

  switch (action) {
    case "setup":
      await cmdSetup();
      break;

    case "install":
      await cmdInstall();
      break;

    case "uninstall":
      await cmdUninstall();
      break;

    case "start":
      await cmdStart();
      break;

    case "update":
      await cmdUpdate();
      break;

    case "doctor": {
      const checkAuth = process.argv.includes("--check-auth") || process.argv.includes("auth", 3);
      const envPath = getStableEnvPath();
      const root = getStableConfigDir();
      const configPath = getStableConfigPath();
      let config;
      try {
        config = await loadConfigFile(configPath, process.env, root);
      } catch {
        console.error(`Config file not found: ${configPath}`);
        console.error("Run 'yhat-mcp setup' first.");
        process.exitCode = 2;
        break;
      }
      const deps: DoctorDependencies = {
        root,
        envPath,
        config,
        secretStore: null,
        pkgVersion: await getLocalVersion(),
        checks: [],
      };
      const report = await runDoctorCore({ flags: { checkAuth }, deps });
      process.stdout.write(`${renderReport(report)}\n`);
      process.exitCode = report.exitCode;
      break;
    }

    default:
      console.log(`Usage: yhat-mcp <command>

Commands:
  setup     Run the interactive setup wizard
  install   Install the MCP server in OpenCode config
  uninstall Remove the MCP server from OpenCode config
  start     Start the MCP server
  update    Check for and install updates
  config    Edit the whitelist interactively
  doctor    Run read-only diagnostic checks (use --check auth to verify credentials)
 `);

  }
})();
