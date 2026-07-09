# SQL Whitelist Specification

## Purpose

Restrict database access to an explicit list of schemas and tables. In Fase 1 all access is read-only; `read_write` mode is reserved for future write support.

## Domain Model

- `AccessMode`: `'read_only' | 'read_write'`.
- `WhitelistEntry`: `{ schema: string; tables: string[]; mode: AccessMode }`.

## Requirements

### Requirement: Whitelist structure

The system MUST accept a whitelist configuration where each entry contains a schema name, a non-empty list of table names, and an access mode.

#### Scenario: Load valid whitelist

- GIVEN a configuration with one whitelist entry
- WHEN the config loader parses it
- THEN the entry is loaded with the schema, tables, and mode

#### Scenario: Duplicate table in whitelist

- GIVEN a whitelist with the same schema and table appearing twice
- WHEN the configuration is loaded
- THEN startup fails with a validation error

### Requirement: Table authorization

The system MUST reject any query that references a schema or table not present in the whitelist.

#### Scenario: Non-whitelisted table

- GIVEN a whitelist containing only `reporting.ventas`
- WHEN a query references `reporting.clientes`
- THEN the query is rejected with an authorization error

#### Scenario: Non-whitelisted schema

- GIVEN a whitelist containing only the `reporting` schema
- WHEN a query references `staging.ventas`
- THEN the query is rejected with an authorization error

### Requirement: Read-only mode

The system MUST allow `SELECT` statements on tables configured as `read_only`.

#### Scenario: SELECT on read-only table

- GIVEN a `read_only` whitelist entry for `reporting.ventas`
- WHEN a `SELECT` query targets `reporting.ventas`
- THEN the query is allowed to proceed

#### Scenario: DML on read-only table

- GIVEN a `read_only` whitelist entry for `reporting.ventas`
- WHEN an `INSERT` targets `reporting.ventas`
- THEN the query is rejected

### Requirement: Read-write mode reserved

The system MUST accept `read_write` entries but MUST NOT authorize DML through them in Fase 1. `read_write` is reserved for future write support; all DML is rejected regardless of mode.

#### Scenario: DML on read-write table

- GIVEN a `read_write` entry for `staging.clientes`
- WHEN an `INSERT` targets `staging.clientes`
- THEN the query is rejected

#### Scenario: Admin DML on read-write table

- GIVEN an `admin` user and a `read_write` entry for `staging.clientes`
- WHEN an `UPDATE` targets `staging.clientes`
- THEN the query is rejected

### Requirement: DDL prohibition

The system MUST NOT allow DDL (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`, etc.) on any table or schema, regardless of mode or role.

#### Scenario: DROP on whitelisted table

- GIVEN a whitelisted table `reporting.ventas`
- WHEN a `DROP TABLE` statement targets it
- THEN the query is rejected

#### Scenario: CREATE in whitelisted schema

- GIVEN a whitelisted schema `reporting`
- WHEN a `CREATE TABLE` statement runs in that schema
- THEN the query is rejected

### Requirement: View support

The system SHOULD treat views as tables for whitelist matching.

#### Scenario: SELECT on whitelisted view

- GIVEN a whitelist entry that includes `reporting.vista_ventas`
- WHEN a `SELECT` targets that view
- THEN the query is allowed
