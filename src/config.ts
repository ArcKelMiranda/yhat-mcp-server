import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";

import { load as loadYaml } from "js-yaml";
import { z } from "zod";

import { ACCESS_MODE, TRANSPORT, type Config } from "./types.js";

function getInstallDir(): string {
  const path = process.argv[1];
  if (path) {
    return join(dirname(path), "..");
  }
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA ?? join(process.env.APPDATA ?? "", "yhat-mcp");
  }
  return join(process.env.HOME ?? "", ".local", "share", "yhat-mcp");
}

export const DEFAULT_CONFIG_PATH = join(getInstallDir(), "config", "yhat-mcp-config.yaml");

const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const ENV_TOKEN_PATTERN = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;
const ENV_TOKEN_ANYWHERE_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

const serverConfigSchema = z
  .object({
    name: z.string({ error: "server.name is required" }).min(1),
    transport: z.literal(TRANSPORT.STDIO),
  })
  .strict();

const databaseConfigSchema = z
  .object({
    host: z.string({ error: "database.host is required" }).min(1),
    port: z.number({ error: "database.port is required" }).int().positive().max(65535),
    name: z.string({ error: "database.name is required" }).min(1),
    user: z.string({ error: "database.user is required" }).min(1),
    passwordEnv: z
      .string({ error: "database.passwordEnv is required" })
      .min(1)
      .regex(ENV_NAME_PATTERN, { error: "database.passwordEnv must be an environment variable name" }),
    encrypt: z.boolean().default(true),
    trustServerCertificate: z.boolean().optional(),
  })
  .strict();

const whitelistEntrySchema = z
  .object({
    schema: z.string({ error: "whitelist.schema is required" }).min(1),
    tables: z.array(z.string({ error: "whitelist.tables entries must be strings" }).min(1)).min(1),
    mode: z.enum([ACCESS_MODE.READ_ONLY, ACCESS_MODE.READ_WRITE]).default(ACCESS_MODE.READ_ONLY),
  })
  .strict()
  .superRefine((entry, context) => {
    const seenTables = new Set<string>();

    for (const [index, table] of entry.tables.entries()) {
      const normalized = normalizeIdentifier(table);

      if (seenTables.has(normalized)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tables", index],
          message: `Duplicate table "${table}" in whitelist entry`,
        });
      }

      seenTables.add(normalized);
    }
  });

const whitelistSchema = z
  .array(whitelistEntrySchema)
  .min(1, { error: "At least one whitelist entry is required" })
  .superRefine((entries, context) => {
    const seenTables = new Set<string>();

    for (const [entryIndex, entry] of entries.entries()) {
      for (const [tableIndex, table] of entry.tables.entries()) {
        const normalizedKey = `${normalizeIdentifier(entry.schema)}.${normalizeIdentifier(table)}`.toLowerCase();

        if (seenTables.has(normalizedKey)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [entryIndex, "tables", tableIndex],
            message: `Duplicate whitelist table "${entry.schema}.${table}"`,
          });
        }

        seenTables.add(normalizedKey);
      }
    }
  });

const limitsConfigSchema = z
  .object({
    maxRows: z.number({ error: "limits.maxRows is required" }).int().positive().default(1000),
    queryTimeoutSeconds: z.number({ error: "limits.queryTimeoutSeconds is required" }).int().positive().default(30),
    largeTableColumnThreshold: z.number().int().positive().optional(),
    largeTableRowThreshold: z.number().int().positive().optional(),
    rateLimitPerMinute: z.number().int().positive().optional(),
  })
  .strict();

const auditConfigSchema = z
  .object({
    logDir: z.string({ error: "audit.logDir is required" }).min(1),
    maxSizeMb: z.number({ error: "audit.maxSizeMb is required" }).int().positive().default(50),
    maxAgeDays: z.number({ error: "audit.maxAgeDays is required" }).int().positive().default(30),
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .strict();

const configSchema = z
  .object({
    server: serverConfigSchema,
    database: databaseConfigSchema,
    whitelist: whitelistSchema,
    limits: limitsConfigSchema,
    audit: auditConfigSchema,
  })
  .strict();

export async function loadConfigFile(configPath: string, env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  let fileContent: string;

  try {
    fileContent = await readFile(configPath, "utf8");
  } catch (error) {
    throw new Error(`Configuration file not found: ${configPath}`, { cause: error });
  }

  let rawDocument: unknown;

  try {
    rawDocument = loadYaml(fileContent);
  } catch (error) {
    throw new Error(`Invalid YAML in ${configPath}`, { cause: error });
  }

  const interpolatedDocument = interpolateNode(rawDocument, env, []);
  let validatedDocument: Config;

  try {
    validatedDocument = configSchema.parse(interpolatedDocument) as Config;
  } catch (error) {
    throw new Error(`Invalid configuration: ${formatConfigValidationError(error)}`, { cause: error });
  }

  return validatedDocument;
}

export function interpolateNode(value: unknown, env: NodeJS.ProcessEnv, path: readonly string[]): unknown {
  if (typeof value === "string") {
    return interpolateString(value, env, path);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => interpolateNode(item, env, [...path, String(index)]));
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(([key, entryValue]) => [key, interpolateNode(entryValue, env, [...path, key])] as const);

    return Object.fromEntries(entries);
  }

  return value;
}

export function interpolateString(value: string, env: NodeJS.ProcessEnv, path: readonly string[]): string {
  const pathKey = path.join(".");

  if (pathKey === "database.passwordEnv") {
    const exactToken = value.match(ENV_TOKEN_PATTERN);

    if (exactToken) {
      const exactVariableName = exactToken[1];

      if (exactVariableName === undefined) {
        throw new Error("database.passwordEnv must reference an environment variable name");
      }

      assertEnvironmentVariable(exactVariableName, env, pathKey);
      return exactVariableName;
    }

    if (!ENV_NAME_PATTERN.test(value)) {
      throw new Error("database.passwordEnv must reference an environment variable name");
    }

    assertEnvironmentVariable(value, env, pathKey);
    return value;
  }

  return value.replace(ENV_TOKEN_ANYWHERE_PATTERN, (_match: string, variableName: string | undefined) => {
    if (variableName === undefined) {
      throw new Error(`Invalid environment token in ${pathKey}`);
    }

    assertEnvironmentVariable(variableName, env, pathKey);
    return env[variableName] ?? "";
  });
}

export function formatConfigValidationError(error: unknown): string {
  if (!(error instanceof z.ZodError)) {
    return error instanceof Error ? error.message : String(error);
  }

  return error.issues
    .map((issue) => {
      const issuePath = issue.path.length > 0 ? issue.path.join(".") : "config";
      return `${issuePath}: ${issue.message}`;
    })
    .join("; ");
}

function assertEnvironmentVariable(name: string, env: NodeJS.ProcessEnv, pathKey: string): void {
  if (env[name] === undefined || env[name] === null || env[name] === "") {
    throw new Error(`Missing environment variable "${name}" referenced at ${pathKey}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeIdentifier(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length >= 2) {
    const firstCharacter = trimmed[0];
    const lastCharacter = trimmed[trimmed.length - 1];

    if (
      (firstCharacter === "[" && lastCharacter === "]") ||
      (firstCharacter === '"' && lastCharacter === '"') ||
      (firstCharacter === "`" && lastCharacter === "`")
    ) {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}
