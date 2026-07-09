# Row Limit Specification

## Purpose

Limit the number of rows returned by `SELECT` queries and warn when broad `SELECT *` queries target large tables.

## Domain Model

- `LimitsConfig`: `{ maxRows: number; queryTimeoutSeconds: number; largeTableColumnThreshold?: number; largeTableRowThreshold?: number }`.

## Requirements

### Requirement: Hard row limit

The system MUST enforce a configured maximum number of rows returned for every `SELECT` query.

#### Scenario: Result within limit

- GIVEN a `maxRows` of 1000
- WHEN a `SELECT` returns 500 rows
- THEN the response contains all rows and no limit error

#### Scenario: Result exceeds limit

- GIVEN a `maxRows` of 1000
- WHEN a `SELECT` returns 1001 rows
- THEN the query is rejected with a message instructing the user to narrow the query or add a `TOP`/`LIMIT` clause

### Requirement: Limit applied to result set

The system MUST apply the row limit to the executed query result set, not rely solely on the query text.

#### Scenario: Query without explicit LIMIT

- GIVEN a `SELECT` with no `TOP`/`LIMIT` clause
- WHEN the result set contains more than `maxRows`
- THEN the query is rejected

### Requirement: SELECT * large-table warning

The system MUST emit a large-table warning when a `SELECT *` query targets a table whose column count or estimated row count exceeds a configured threshold.

#### Scenario: SELECT * on large table

- GIVEN a table with more than `largeTableColumnThreshold` columns
- WHEN a `SELECT *` query targets that table
- THEN the response includes a warning about the broad query

#### Scenario: SELECT * on small table

- GIVEN a table below both thresholds
- WHEN a `SELECT *` query targets that table
- THEN the response does not include a large-table warning

### Requirement: Warning presentation

The system SHOULD include the warning text alongside the query results when the query is allowed.

#### Scenario: Large table still within row limit

- GIVEN a `SELECT *` on a large table that returns 100 rows and `maxRows` is 1000
- WHEN the response is built
- THEN the results are returned with a warning message

### Requirement: Default limit

The system MUST provide a default row limit when none is configured.

#### Scenario: Missing limit config

- GIVEN a configuration without `maxRows`
- WHEN the server starts
- THEN the default limit is 1000

### Requirement: Valid limit values

The system MUST reject non-positive or non-integer row limits.

#### Scenario: Zero max rows

- GIVEN a configuration with `maxRows: 0`
- WHEN the server starts
- THEN startup fails with a validation error
