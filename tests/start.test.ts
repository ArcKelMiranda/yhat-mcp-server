import { describe, it } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert/strict";

import { runStartCommand } from "../src/start.js";

describe("start command flow", () => {
  it("starts the server in-process and triggers the update check", async () => {
    const calls: string[] = [];

    await runStartCommand({
      createServer: () => ({
        start: async () => {
          calls.push("server.start");
        },
      }),
      checkForUpdate: async () => {
        calls.push("update.check");
        return { hasUpdate: false, latestVersion: "0.1.0", localVersion: "0.1.0" };
      },
      stderr: { write: () => true },
    });

    deepStrictEqual(calls, ["update.check", "server.start"]);
  });

  it("swallows update check failures without blocking startup", async () => {
    const calls: string[] = [];

    await runStartCommand({
      createServer: () => ({
        start: async () => {
          calls.push("server.start");
        },
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
