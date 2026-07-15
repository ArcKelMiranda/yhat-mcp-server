import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { match } from "node:assert/strict";

describe("repo secret cleanup", () => {
  it("does not keep a plaintext database password in the tracked .env", () => {
    const env = readFileSync(".env", "utf8");

    match(env, /^YHAT_DB_PASSWORD=\s*$/m);
  });
});
