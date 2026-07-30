# Capability Spec: query-guard

## Purpose

This capability locks the current behavior of `classifyQuery()` and `authorizeQueryTables()` so refactors or `node-sql-parser` changes cannot silently reintroduce regressions. It intentionally preserves two current quirks: CTE aliases appear in `classification.tables`, and `mode` does not affect whitelist authorization.

## Requirements

### Requirement: The validator captures deep references in `classification.tables`

The system SHALL include every table referenced at any relevant AST depth in `classification.tables`.

#### Scenario: Simple SELECT captures one table
- **Given** `SELECT * FROM dbo.users`
- **When** `classifyQuery()` is called
- **Then** `classification.tables = [dbo.users]`

#### Scenario: UNION captures both branches
- **Given** `SELECT * FROM dbo.users UNION SELECT * FROM dbo.orders`
- **When** `classifyQuery()` is called
- **Then** `classification.tables` contains `dbo.users` and `dbo.orders`

#### Scenario: UNION ALL captures both branches
- **Given** `SELECT * FROM dbo.users UNION ALL SELECT * FROM dbo.orders`
- **When** `classifyQuery()` is called
- **Then** `classification.tables` contains `dbo.users` and `dbo.orders`

#### Scenario: Subquery IN captures both levels
- **Given** `SELECT * FROM dbo.orders WHERE customer_id IN (SELECT id FROM dbo.blacklist)`
- **When** `classifyQuery()` is called
- **Then** `classification.tables` contains `dbo.orders` and `dbo.blacklist`

#### Scenario: CTE includes the alias in the table list
- **Given** `WITH x AS (SELECT * FROM dbo.users) SELECT * FROM x`
- **When** `classifyQuery()` is called
- **Then** `classification.tables` contains `dbo.users` and also `x`

#### Scenario: JOIN captures both tables
- **Given** `SELECT * FROM dbo.users u JOIN dbo.orders o ON u.id = o.user_id`
- **When** `classifyQuery()` is called
- **Then** `classification.tables` contains `dbo.users` and `dbo.orders`

### Requirement: The whitelist authorizes only included tables and blocks on first absence

The system SHALL block authorization when any table in `classification.tables` is absent from the whitelist, and SHALL stop at the first missing table.

#### Scenario: Empty whitelist blocks a simple SELECT
- **Given** an empty whitelist and `classification.tables = [dbo.users]`
- **When** `authorizeQueryTables()` is called
- **Then** the result is BLOCKED with `whitelist_denied`

#### Scenario: Exact whitelist authorizes a simple SELECT
- **Given** a whitelist containing `dbo.users`
- **When** `SELECT * FROM dbo.users` is authorized
- **Then** the result is ALLOWED

#### Scenario: Partial UNION whitelist blocks the missing table
- **Given** a whitelist containing only `dbo.users`
- **When** `SELECT * FROM dbo.users UNION SELECT * FROM dbo.orders` is authorized
- **Then** the result is BLOCKED and the message names `dbo.orders`

#### Scenario: CTE blocks the non-whitelisted alias
- **Given** a whitelist containing only `dbo.users`
- **When** `WITH x AS (SELECT * FROM dbo.users) SELECT * FROM x` is authorized
- **Then** the result is BLOCKED on `x`

#### Scenario: JOIN blocks the missing right-hand table
- **Given** a whitelist containing only `dbo.users`
- **When** `SELECT * FROM dbo.users u JOIN dbo.orders o ON u.id = o.user_id` is authorized
- **Then** the result is BLOCKED on `dbo.orders`

#### Scenario: Unqualified identifier with schema collision is rejected
- **Given** a whitelist containing `dbo.users` and `sdk.users`
- **When** `SELECT * FROM users` is authorized
- **Then** the result is BLOCKED due to ambiguity

#### Scenario: Bracketed identifiers are normalized
- **Given** a whitelist containing `dbo.users`
- **When** `SELECT * FROM [dbo].[users]` is authorized
- **Then** the result is ALLOWED

#### Scenario: Quoted identifiers are normalized
- **Given** a whitelist containing `dbo.users`
- **When** `SELECT * FROM "dbo"."users"` is authorized
- **Then** the result is ALLOWED

### Requirement: The `mode` field does not alter authorization

The system SHALL NOT use the `mode` field of a whitelist entry to change the authorization decision.

#### Scenario: `mode: read_only` still authorizes SELECT
- **Given** a whitelist with `{ schema: 'dbo', tables: ['users'], mode: 'read_only' }`
- **When** `SELECT * FROM dbo.users` is authorized
- **Then** the result is ALLOWED

#### Scenario: `mode: read_write` still authorizes SELECT
- **Given** a whitelist with `{ schema: 'dbo', tables: ['users'], mode: 'read_write' }`
- **When** `SELECT * FROM dbo.users` is authorized
- **Then** the result is ALLOWED

### Requirement: The validator blocks empty or invalid SQL

The system SHALL return `parse_error` for empty or syntactically invalid SQL.

#### Scenario: Empty SQL returns parse_error
- **Given** an empty SQL string
- **When** `classifyQuery()` is called
- **Then** the result is BLOCKED with `parse_error`

#### Scenario: Invalid SQL returns parse_error
- **Given** `MALFORMED SQL FROM`
- **When** `classifyQuery()` is called
- **Then** the result is BLOCKED with `parse_error`
