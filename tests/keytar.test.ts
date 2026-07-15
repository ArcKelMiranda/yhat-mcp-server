import { describe, it } from "node:test";
import { deepStrictEqual, match, strictEqual } from "node:assert/strict";

import {
  KEYTAR_ACCOUNT,
  KEYTAR_SERVICE,
  saveDatabasePassword,
  resolveDatabasePassword,
} from "../src/keytar.js";

describe("database secret resolution", () => {
  it("stores the database password under the expected keychain coordinates", async () => {
    const calls: Array<{ service: string; account: string; password: string }> = [];

    const result = await saveDatabasePassword("s3cr3t", {
      setPassword: async (service: string, account: string, password: string): Promise<void> => {
        calls.push({ service, account, password });
      },
      getPassword: async () => null,
      deletePassword: async () => true,
    });

    strictEqual(result, true);
    deepStrictEqual(calls, [{ service: KEYTAR_SERVICE, account: KEYTAR_ACCOUNT, password: "s3cr3t" }]);
  });

  it("prefers keychain over env and falls back to env when keychain is empty", async () => {
    const env = { YHAT_DB_PASSWORD: "from-env" };

    const secret = await resolveDatabasePassword("YHAT_DB_PASSWORD", env, {
      getPassword: async () => null,
      setPassword: async (): Promise<void> => {},
      deletePassword: async () => true,
    });

    strictEqual(secret, "from-env");
  });

  it("throws a setup-guiding error when the secret is missing", async () => {
    await resolveDatabasePassword("YHAT_DB_PASSWORD", {}, {
      getPassword: async () => null,
      setPassword: async (): Promise<void> => {},
      deletePassword: async () => true,
    }).then(
      () => {
        throw new Error("expected rejection");
      },
      (error: unknown) => {
        strictEqual(error instanceof Error, true);
        match((error as Error).message, /yhat-mcp setup/i);
      },
    );
  });
});
