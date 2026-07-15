import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { KEYTAR_ACCOUNT, KEYTAR_SERVICE, type SecretStore, saveSecret } from "./keytar.js";
import { getConfigRoot, getDefaultConfigPath, getEnvPath } from "./paths.js";

interface MigrationOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  secretStore?: SecretStore | null;
}

interface EnvVars {
  [key: string]: string | undefined;
}

export async function migrateStableConfig(options: MigrationOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const secretStore = options.secretStore;

  const configRoot = getConfigRoot(env);
  const stableConfigPath = getDefaultConfigPath(env);
  const stableEnvPath = getEnvPath(env);
  const repoConfigPath = join(cwd, "config", "yhat-mcp-config.yaml");
  const repoEnvPath = join(cwd, ".env");

  const stableConfigExists = await exists(stableConfigPath);
  const stableEnvExists = await exists(stableEnvPath);
  const repoConfigExists = await exists(repoConfigPath);
  const repoEnvExists = await exists(repoEnvPath);

  if (!repoConfigExists && !repoEnvExists) {
    return;
  }

  await mkdir(dirname(stableConfigPath), { recursive: true });

  if (!stableConfigExists && repoConfigExists) {
    await writeStableFile(repoConfigPath, stableConfigPath);
  }

  if (!stableEnvExists && repoEnvExists) {
    const envVars = await readEnvFile(repoEnvPath);
    const password = envVars.YHAT_DB_PASSWORD;

    if (password) {
      const saved = await saveSecret(KEYTAR_ACCOUNT, password, secretStore);

      if (saved) {
        delete envVars.YHAT_DB_PASSWORD;
      }
    }

    await writeEnvFile(stableEnvPath, envVars);
  }
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

  await writeFile(path, `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`, "utf8");
}

async function writeStableFile(sourcePath: string, destinationPath: string): Promise<void> {
  await copyFile(sourcePath, destinationPath);
}

async function copyFile(sourcePath: string, destinationPath: string): Promise<void> {
  const content = await readFile(sourcePath, "utf8");
  await writeFile(destinationPath, content, "utf8");
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}
