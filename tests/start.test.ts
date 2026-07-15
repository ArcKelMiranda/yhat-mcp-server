import { describe, it } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert/strict";

import { runStartCommand } from "../src/start.js";

describe("start command flow", () => {
  it("starts the server in-process and triggers the update check", async () => {
    const calls: string[] = [];
    const writes: string[] = [];

    await runStartCommand({
      createServer: () => ({
        state: "stopped",
        start: async () => {
          calls.push("server.start");
        },
        stop: async () => {},
      }),
      checkForUpdate: async () => {
        calls.push("update.check");
        return { hasUpdate: false, latestVersion: "0.1.0", localVersion: "0.1.0" };
      },
      stderr: { write: (chunk: string) => {
        writes.push(chunk);
        return true;
      } },
    });

    deepStrictEqual(calls, ["update.check", "server.start"]);
    strictEqual(writes.some((line) => line.includes("MCP listo")), true);
    strictEqual(writes.some((line) => line.includes("stdio")), true);
    strictEqual(writes.some((line) => line.includes("PID")), true);
  });

  it("swallows update check failures without blocking startup", async () => {
    const calls: string[] = [];

    await runStartCommand({
      createServer: () => ({
        state: "stopped",
        start: async () => {
          calls.push("server.start");
        },
        stop: async () => {},
      }),
      checkForUpdate: async () => {
        calls.push("update.check");
        throw new Error("network down");
      },
      stderr: { write: () => true },
    });

    strictEqual(calls.includes("server.start"), true);
  });
});
