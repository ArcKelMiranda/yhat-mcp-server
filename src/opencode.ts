export interface OpenCodeServerEntry {
  type: "local";
  command: readonly ["yhat-mcp", "start"];
}

export interface OpenCodeConfig {
  mcp?: Record<string, unknown>;
}

export function buildOpenCodeServerEntry(): OpenCodeServerEntry {
  return {
    type: "local",
    command: ["yhat-mcp", "start"],
  };
}

export function buildOpenCodeConfig(existing: OpenCodeConfig | null, serverName = "yhat-sql"): OpenCodeConfig {
  return {
    ...(existing ?? {}),
    mcp: {
      ...(existing?.mcp ?? {}),
      [serverName]: buildOpenCodeServerEntry(),
    },
  };
}
