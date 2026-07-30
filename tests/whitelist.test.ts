import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { authorizeQueryTables } from "../src/whitelist.js";
import { classifyQuery } from "../src/validator.js";
import { BLOCK_RULE, type WhitelistEntry } from "../src/types.js";

function decision(sql: string, whitelist: readonly WhitelistEntry[]) {
  return authorizeQueryTables(classifyQuery(sql).classification, whitelist);
}

describe("whitelist — authorized cases", () => {
  it("allows single-table SELECT when only that table is whitelisted", () => {
    const result = decision("SELECT * FROM dbo.users", [{ schema: "dbo", tables: ["users"], mode: "read_only" }]);

    assert.equal(result.allowed, true);
  });

  it("allows UNION when both branches whitelisted", () => {
    const result = decision("SELECT * FROM dbo.users UNION SELECT * FROM dbo.orders", [
      { schema: "dbo", tables: ["users", "orders"], mode: "read_only" },
    ]);

    assert.equal(result.allowed, true);
  });

  it("allows JOIN when both tables whitelisted", () => {
    const result = decision("SELECT * FROM dbo.users u JOIN dbo.orders o ON u.id = o.user_id", [
      { schema: "dbo", tables: ["users", "orders"], mode: "read_only" },
    ]);

    assert.equal(result.allowed, true);
  });

  it("allows CTE only when alias is whitelisted (locks current CTE-alias behavior)", () => {
    const result = decision("WITH x AS (SELECT * FROM dbo.users) SELECT * FROM x", [
      { schema: "dbo", tables: ["users"], mode: "read_only" },
      { schema: "", tables: ["x"], mode: "read_only" },
    ]);

    assert.equal(result.allowed, true);
  });
});

describe("whitelist — denied cases", () => {
  it("denies UNION when second branch not whitelisted", () => {
    const result = decision("SELECT * FROM dbo.users UNION SELECT * FROM dbo.orders", [
      { schema: "dbo", tables: ["users"], mode: "read_only" },
    ]);

    assert.equal(result.allowed, false);
    assert.equal(result.reason?.rule, BLOCK_RULE.WHITELIST_DENIED);
    assert.match(result.reason?.message ?? "", /dbo\.orders/);
  });

  it("denies IN subquery when inner table not whitelisted", () => {
    const result = decision("SELECT * FROM dbo.orders WHERE customer_id IN (SELECT id FROM dbo.blacklist)", [
      { schema: "dbo", tables: ["orders"], mode: "read_only" },
    ]);

    assert.equal(result.allowed, false);
    assert.equal(result.reason?.rule, BLOCK_RULE.WHITELIST_DENIED);
  });

  it("denies JOIN when second table not whitelisted", () => {
    const result = decision("SELECT * FROM dbo.users u JOIN dbo.orders o ON u.id = o.user_id", [
      { schema: "dbo", tables: ["users"], mode: "read_only" },
    ]);

    assert.equal(result.allowed, false);
    assert.equal(result.reason?.rule, BLOCK_RULE.WHITELIST_DENIED);
  });

  it("denies CTE when alias not whitelisted", () => {
    const result = decision("WITH x AS (SELECT * FROM dbo.users) SELECT * FROM x", [
      { schema: "dbo", tables: ["users"], mode: "read_only" },
    ]);

    assert.equal(result.allowed, false);
    assert.equal(result.reason?.rule, BLOCK_RULE.WHITELIST_DENIED);
  });
});

describe("whitelist — identifier normalization", () => {
  it("normalizes bracketed identifiers [dbo].[users]", () => {
    const result = decision("SELECT * FROM [dbo].[users]", [{ schema: "dbo", tables: ["users"], mode: "read_only" }]);

    assert.equal(result.allowed, true);
  });

  it("normalizes double-quoted identifiers", () => {
    const result = decision('SELECT * FROM "dbo"."users"', [{ schema: "dbo", tables: ["users"], mode: "read_only" }]);

    assert.equal(result.allowed, true);
  });

  it("is case-insensitive on identifier match", () => {
    const result = decision("SELECT * FROM DBO.USERS", [{ schema: "dbo", tables: ["users"], mode: "read_only" }]);

    assert.equal(result.allowed, true);
  });
});

describe("whitelist — collision", () => {
  it("rejects unqualified table ambiguous across schemas with a clear error", () => {
    const result = decision("SELECT * FROM users", [
      { schema: "dbo", tables: ["users"], mode: "read_only" },
      { schema: "sdk", tables: ["users"], mode: "read_only" },
    ]);

    assert.equal(result.allowed, false);
    assert.equal(result.reason?.rule, BLOCK_RULE.WHITELIST_DENIED);
    assert.match(result.reason?.message ?? "", /multiple whitelist entries/i);
  });
});

describe("whitelist — mode field", () => {
  it("ignores mode: read_only in authorization decision", () => {
    const result = decision("SELECT * FROM dbo.users", [{ schema: "dbo", tables: ["users"], mode: "read_only" }]);

    assert.equal(result.allowed, true);
  });

  it("ignores mode: read_write in authorization decision", () => {
    const result = decision("SELECT * FROM dbo.users", [{ schema: "dbo", tables: ["users"], mode: "read_write" }]);

    assert.equal(result.allowed, true);
  });
});
