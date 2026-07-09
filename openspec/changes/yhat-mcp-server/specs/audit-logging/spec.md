# Audit Logging Specification

## Purpose

Record metadata about every query request for security review and usage analysis without exposing result data, PII, or secrets.

## Domain Model

- `AuditEntry`: `{ timestamp: string; userIdentity: string; clientInfo?: string; queryText: string; tables: string[]; status: 'ALLOWED' | 'BLOCKED'; rowsReturned: number | null; durationMs: number; errorCategory?: string; configVersion?: string }`.

## Requirements

### Requirement: One entry per request

The system MUST emit exactly one audit log entry for each query request received.

#### Scenario: Allowed SELECT

- GIVEN a `SELECT` query that passes all guards
- WHEN the query is executed
- THEN an audit entry is written with status `ALLOWED`

#### Scenario: Blocked query

- GIVEN a query that fails the guard
- WHEN the query is rejected
- THEN an audit entry is written with status `BLOCKED`

### Requirement: Metadata fields

Each audit entry MUST include timestamp, user identity, client information, query text, referenced tables, status, rows returned or `null`, duration, and error category when applicable.

#### Scenario: Complete metadata

- GIVEN a successful `SELECT` query
- WHEN the audit entry is created
- THEN all required metadata fields are present

### Requirement: No data leakage

The system MUST NOT include query result values, PII, or financial data in audit log entries.

#### Scenario: Select with sensitive columns

- GIVEN a query that returns salary and credit card columns
- WHEN the audit log entry is written
- THEN the result values do not appear in the entry

### Requirement: Secret redaction

The system MUST redact credentials, connection strings, and secrets from the audit log entry.

#### Scenario: Query containing password literal

- GIVEN a query text that contains a password literal
- WHEN the entry is logged
- THEN the secret value is replaced with a redaction marker

### Requirement: Log levels

The system MUST log allowed queries at `INFO` level and blocked queries at `WARN` level.

#### Scenario: Allowed logs at INFO

- GIVEN a query that is allowed
- WHEN the entry is emitted
- THEN it is written at `INFO` level

#### Scenario: Blocked logs at WARN

- GIVEN a query that is blocked
- WHEN the entry is emitted
- THEN it is written at `WARN` level

### Requirement: Log rotation

The system MUST rotate audit log files based on configured maximum age and size.

#### Scenario: Size-based rotation

- GIVEN a log file that reaches the configured maximum size
- WHEN the next entry is written
- THEN a new log file is created

### Requirement: Log level configuration

The system SHOULD allow the log level to be configured.

#### Scenario: Debug configuration

- GIVEN a configuration with log level `DEBUG`
- WHEN the server runs
- THEN diagnostic messages are emitted, but audit entries remain metadata-only
