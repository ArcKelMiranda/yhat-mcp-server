import type { ServerRuntime } from "./types.js";

export interface StartCheckResult {
  hasUpdate: boolean;
  latestVersion: string;
  localVersion: string;
}

export interface StartDependencies {
  createServer(): ServerRuntime;
  checkForUpdate(): Promise<StartCheckResult>;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export async function runStartCommand(deps: StartDependencies): Promise<void> {
  deps.stderr.write(`[yhat-mcp] Starting MCP server over stdio (PID ${process.pid})\n`);
  deps.stderr.write("[yhat-mcp] MCP listo\n");

  void deps.checkForUpdate()
    .then((update) => {
      if (update.hasUpdate) {
        deps.stderr.write(`\n[yhat-mcp] Update available: ${update.latestVersion} (current: ${update.localVersion})\n`);
        deps.stderr.write("[yhat-mcp] Run 'yhat-mcp update' to upgrade.\n");
      }
    })
    .catch(() => {
      // Silently ignore update check errors.
    });

  const server = deps.createServer();
  await server.start();
}
