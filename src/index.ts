import process from "node:process";

import { prepareRuntimeEnvironment } from "./runtime.js";

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

async function main(): Promise<void> {
  prepareRuntimeEnvironment();

  const { createServer } = await import("./server.js");
  const server = createServer();

  await server.start();
}

void main().catch((error: unknown) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
