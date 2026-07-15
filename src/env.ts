import { readFileSync } from "node:fs";

import { config as loadDotenv, parse as parseDotenv } from "dotenv";

import { getEnvPath } from "./paths.js";

export function loadEnv(): ReturnType<typeof loadDotenv> {
  const envPath = getEnvPath();
  const result = loadDotenv({ path: envPath, override: false });
  const stableValues = result.parsed ?? readStableEnv(envPath);

  if (stableValues !== undefined) {
    for (const [key, value] of Object.entries(stableValues)) {
      if (key.startsWith("YHAT_DB_")) {
        process.env[key] = value;
      }
    }
  }

  return result;
}

function readStableEnv(envPath: string): Record<string, string> | undefined {
  try {
    return parseDotenv(readFileSync(envPath, "utf8"));
  } catch {
    return undefined;
  }
}
