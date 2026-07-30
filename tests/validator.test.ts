import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyQuery } from "../src/validator.js";
import { BLOCK_RULE } from "../src/types.js";

function tableKey(table: { schema?: string; name: string }): string {
  return `${table.schema ?? ""}.${table.name}`;
}

function sortedTableKeys(tables: readonly { schema?: string; name: string }[]): string[] {
  return [...tables].map(tableKey).sort();
}

describe("classifier — deep reference capture", () => {
  it("captures the single FROM table for plain SELECT", () => {
    const result = classifyQuery("SELECT * FROM dbo.users");

    assert.equal(result.allowed, true);
    assert.deepEqual(sortedTableKeys(result.classification.tables), ["dbo.users"]);
  });

  it("captures tables in both UNION branches", () => {
    const result = classifyQuery("SELECT * FROM dbo.users UNION SELECT * FROM dbo.orders");

    assert.equal(result.allowed, true);
    assert.deepEqual(sortedTableKeys(result.classification.tables), ["dbo.orders", "dbo.users"]);
  });

  it("captures tables in both UNION ALL branches", () => {
    const result = classifyQuery("SELECT * FROM dbo.users UNION ALL SELECT * FROM dbo.orders");

    assert.equal(result.allowed, true);
    assert.deepEqual(sortedTableKeys(result.classification.tables), ["dbo.orders", "dbo.users"]);
  });

  it("captures tables in IN subquery (deep reference)", () => {
    const result = classifyQuery("SELECT * FROM dbo.orders WHERE customer_id IN (SELECT id FROM dbo.blacklist)");

    assert.equal(result.allowed, true);
    assert.deepEqual(sortedTableKeys(result.classification.tables), ["dbo.blacklist", "dbo.orders"]);
  });

  it("captures CTE alias AND the CTE's source table (locks CTE-alias-in-tableList behavior)", () => {
    const result = classifyQuery("WITH x AS (SELECT * FROM dbo.users) SELECT * FROM x");

    assert.equal(result.allowed, true);
    assert.ok(result.classification.tables.some((table) => table.schema === "dbo" && table.name === "users"));
    assert.ok(result.classification.tables.some((table) => table.schema === undefined && table.name === "x"));
  });

  it("captures both tables in JOIN", () => {
    const result = classifyQuery("SELECT * FROM dbo.users u JOIN dbo.orders o ON u.id = o.user_id");

    assert.equal(result.allowed, true);
    assert.deepEqual(sortedTableKeys(result.classification.tables), ["dbo.orders", "dbo.users"]);
  });
});

describe("classifier — parse failures", () => {
  it("rejects empty input with parse_error", () => {
    const result = classifyQuery("");

    assert.equal(result.allowed, false);
    assert.equal(result.reason?.rule, BLOCK_RULE.PARSE_ERROR);
  });

  it("rejects malformed SQL with parse_error", () => {
    const result = classifyQuery("MALFORMED SQL FROM");

    assert.equal(result.allowed, false);
    assert.equal(result.reason?.rule, BLOCK_RULE.PARSE_ERROR);
  });
});
