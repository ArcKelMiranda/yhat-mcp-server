# Query Guard Specification

## Purpose

Analyze SQL queries through an AST to block destructive, unsafe, or unsupported statements before execution.

## Domain Model

- `QueryClassification`: `{ type: 'SELECT' | 'DML' | 'DDL' | 'UNKNOWN'; tables: string[]; hasWhereClause?: boolean; isAlwaysTrueWhere?: boolean }`.
- `UserRole`: `'reader' | 'admin'` for v1.

## Requirements

### Requirement: SQL parsing

The system MUST parse incoming SQL using T-SQL grammar and block queries that cannot be parsed.

#### Scenario: Valid SELECT parses

- GIVEN a syntactically valid `SELECT` statement
- WHEN the guard parses it
- THEN the query classification is returned

#### Scenario: Malformed SQL

- GIVEN a statement with invalid T-SQL syntax
- WHEN the guard parses it
- THEN the query is blocked with a parse error

### Requirement: DDL blocking

The system MUST block all DDL statements (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`, etc.) for every user role.

#### Scenario: DROP TABLE

- GIVEN a `DROP TABLE` statement
- WHEN the guard evaluates it
- THEN the query is blocked

#### Scenario: ALTER TABLE

- GIVEN an `ALTER TABLE` statement
- WHEN the guard evaluates it
- THEN the query is blocked

### Requirement: DML blocking

The system MUST block all DML statements (`INSERT`, `UPDATE`, `DELETE`, and `MERGE`) for every user role in Fase 1.

#### Scenario: Reader UPDATE

- GIVEN a `reader` user
- WHEN an `UPDATE` statement is submitted
- THEN the query is blocked

#### Scenario: Admin DML

- GIVEN an `admin` user
- WHEN an `INSERT` statement is submitted
- THEN the query is blocked

#### Scenario: MERGE blocked

- GIVEN any user role
- WHEN a `MERGE` statement is submitted
- THEN the query is blocked

### Requirement: Unsafe WHERE clause

The system MUST block `UPDATE` and `DELETE` statements that lack a `WHERE` clause or whose `WHERE` clause is always true. This rule remains active for future write support; in Fase 1 the DML rule already blocks these statements.

#### Scenario: DELETE without WHERE

- GIVEN a `DELETE` statement without a `WHERE` clause
- WHEN the guard evaluates it
- THEN the query is blocked

#### Scenario: UPDATE with tautology

- GIVEN an `UPDATE` with `WHERE 1 = 1`
- WHEN the guard evaluates it
- THEN the query is blocked

### Requirement: Multi-statement blocking

The system MUST block any query containing multiple SQL statements.

#### Scenario: Semicolon-separated queries

- GIVEN a string containing two `SELECT` statements separated by a semicolon
- WHEN the guard parses it
- THEN the query is blocked

### Requirement: Error clarity

The system SHOULD return a clear error message identifying the guard rule that blocked the query.

#### Scenario: Blocked query message

- GIVEN a query blocked by the DDL rule
- WHEN the guard rejects it
- THEN the response includes the rule name and a human-readable explanation

### Requirement: Parameter safety

The system MUST ensure user-provided values are passed as bound parameters and not interpreted as SQL fragments.

#### Scenario: Literal SQL keywords

- GIVEN a query argument containing the text `'; DROP TABLE reporting.ventas --'`
- WHEN the argument is bound as a parameter
- THEN the value is treated as a literal and the query is not altered
