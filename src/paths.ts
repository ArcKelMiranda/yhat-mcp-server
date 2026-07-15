import { homedir } from "node:os";
import { posix, win32 } from "node:path";

const CONFIG_NAME = "yhat-mcp";
const CONFIG_FILE_NAME = "yhat-mcp-config.yaml";

export function getConfigRoot(
  env: NodeJS.ProcessEnv = process.env,
  platformName: NodeJS.Platform = process.platform,
  homeDirectory: string = homedir(),
): string {
  const explicitRoot = env.YHAT_CONFIG_ROOT;

  if (explicitRoot !== undefined && explicitRoot.trim() !== "") {
    return normalizeWithPlatform(explicitRoot, platformName);
  }

  if (platformName !== "win32") {
    const xdgDataHome = env.XDG_DATA_HOME;

    if (xdgDataHome !== undefined && xdgDataHome.trim() !== "") {
      return joinWithPlatform(platformName, xdgDataHome, CONFIG_NAME);
    }

    return joinWithPlatform(platformName, homeDirectory, ".local", "share", CONFIG_NAME);
  }

  const appDataRoot = env.LOCALAPPDATA ?? env.APPDATA ?? joinWithPlatform("win32", homeDirectory, "AppData", "Local");

  return joinWithPlatform("win32", appDataRoot, CONFIG_NAME);
}

export function getConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  platformName: NodeJS.Platform = process.platform,
  homeDirectory: string = homedir(),
): string {
  return joinWithPlatform(platformName, getConfigRoot(env, platformName, homeDirectory), "config");
}

export function getEnvPath(
  env: NodeJS.ProcessEnv = process.env,
  platformName: NodeJS.Platform = process.platform,
  homeDirectory: string = homedir(),
): string {
  return joinWithPlatform(platformName, getConfigRoot(env, platformName, homeDirectory), ".env");
}

export function getDefaultConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  platformName: NodeJS.Platform = process.platform,
  homeDirectory: string = homedir(),
): string {
  return joinWithPlatform(platformName, getConfigDir(env, platformName, homeDirectory), CONFIG_FILE_NAME);
}

export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  platformName: NodeJS.Platform = process.platform,
  homeDirectory: string = homedir(),
): string {
  const override = env.YHAT_CONFIG_PATH;

  if (override !== undefined && override.trim() !== "") {
    return normalizeWithPlatform(override, platformName);
  }

  return getDefaultConfigPath(env, platformName, homeDirectory);
}

export function resolveAuditLogDir(
  logDir: string,
  configRoot: string,
  platformName: NodeJS.Platform = process.platform,
): string {
  const pathApi = platformName === "win32" ? win32 : posix;

  if (pathApi.isAbsolute(logDir)) {
    return pathApi.normalize(logDir);
  }

  return pathApi.join(configRoot, logDir);
}

export const CONFIG_ROOT = getConfigRoot();
export const CONFIG_DIR = getConfigDir();
export const ENV_PATH = getEnvPath();
export const DEFAULT_CONFIG_PATH = getDefaultConfigPath();

function joinWithPlatform(platformName: NodeJS.Platform, ...segments: string[]): string {
  return (platformName === "win32" ? win32 : posix).join(...segments);
}

function normalizeWithPlatform(value: string, platformName: NodeJS.Platform): string {
  return (platformName === "win32" ? win32 : posix).normalize(value);
}
