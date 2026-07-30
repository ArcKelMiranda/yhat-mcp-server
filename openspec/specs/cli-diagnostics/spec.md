# Capability Spec: cli-diagnostics

## Purpose

This capability covers CLI subcommands of `yhat-mcp` whose purpose is to
inspect the state of the installation without modifying it. The change
introduces the `doctor` subcommand, which executes a suite of nine read-only
checks over the critical components of the runtime (config, keytar, secret,
audit log, OpenCode registration, TCP connectivity, and optionally credentials
against the SQL Server) and reports the status of each along with a
processable exit code. The output adapts to its destination (text on a TTY,
JSON on a pipe or redirection) and never exposes the value of stored secrets.

Existing subcommands (`setup`, `start`, `install`, etc.) are not affected
and keep their behaviour.

## Requirements

### Requirement: Doctor executes the read-only check suite

The system SHALL provide the `yhat-mcp doctor` subcommand that runs the full
read-only check suite and returns an aggregated exit code based on the worst
observed status, with the following hierarchy: `FAIL > WARN > OK`.

#### Scenario: Doctor exits with code 0 when all checks pass

- **Given** a fully configured installation (config present, keytar loadable,
  secret stored, audit directory writable, OpenCode registered, TCP probe
  successful)
- **When** the user runs `yhat-mcp doctor`
- **Then** the process exits with exit code `0`
- **And** the report lists every executed check with status `OK`

#### Scenario: Doctor exits with code 1 when at least one check is WARN

- **Given** an installation where the only non-`OK` check is a check
  classified as `WARN` (for example, `keytar` not loadable on a platform
  where the keychain is non-standard)
- **When** the user runs `yhat-mcp doctor`
- **Then** the process exits with exit code `1`
- **And** the report lists that check with status `WARN` and the rest with
  `OK`

#### Scenario: Doctor exits with code 2 when at least one check is FAIL

- **Given** an installation where the only non-`OK` check is a check
  classified as `FAIL` (for example, keytar loadable but no secret stored, or
  keytar not loadable on a platform that requires it)
- **When** the user runs `yhat-mcp doctor`
- **Then** the process exits with exit code `2`
- **And** the report lists that check with status `FAIL` and the rest with
  `OK`

#### Scenario: Doctor prioritises FAIL over WARN in the exit code

- **Given** an installation with at least one check in `WARN` and at least
  one check in `FAIL`
- **When** the user runs `yhat-mcp doctor`
- **Then** the process exits with exit code `2`
- **And** the report lists both checks with their respective statuses

### Requirement: Doctor adapts the output format to the destination

The system SHALL detect whether stdout is an interactive terminal
(`process.stdout.isTTY === true`) and, based on that, render the report as a
text table or as a JSON object. The underlying data structure SHALL be the
same in both formats; only the representation changes.

#### Scenario: Text output when stdout is a TTY

- **Given** a process where `process.stdout.isTTY === true`
- **When** the user runs `yhat-mcp doctor`
- **Then** the output is a text table with columns for the check name, the
  status (`OK`/`WARN`/`FAIL`) and a short detail
- **And** the table is readable on an 80-column terminal without truncation

#### Scenario: JSON output when stdout is not a TTY

- **Given** a process where `process.stdout.isTTY` is `false` or `undefined`
  (pipe, redirection or CI execution)
- **When** the user runs `yhat-mcp doctor`
- **Then** the output is a single JSON object serialised on a single line
- **And** the object is parseable by `JSON.parse(stdout)` without preprocessing

#### Scenario: JSON output uses LF line endings

- **Given** any invocation of `yhat-mcp doctor` that produces JSON output on
  a Windows machine
- **When** the binary output is captured and the bytes inspected
- **Then** the output contains only `0x0A` bytes as line separators, without
  spurious `0x0D` (CR) bytes

### Requirement: Doctor never prints the value of secrets

The system SHALL redact or exclude any stored secret value (keytar,
environment variables interpolated in the config) in both stdout and stderr,
in both text and JSON formats.

#### Scenario: The secret value does not appear in text output

- **Given** a secret stored in keytar with an arbitrary value
- **When** the user runs `yhat-mcp doctor` in TTY mode
- **Then** neither stdout nor stderr contains the secret value, fully or
  partially

#### Scenario: The secret value does not appear in JSON output

- **Given** a secret stored in keytar with an arbitrary value
- **When** the user runs `yhat-mcp doctor` with stdout redirected to a file
- **Then** the resulting JSON does not contain the secret value, not even
  encoded or truncated

### Requirement: Doctor aborts fast when the configuration does not exist

The system SHALL terminate immediately with exit code `2` and an actionable
message when the configuration file is not found at the path resolved by
`getConfigRoot` / `getEnvPath`, without running the rest of the checks.

#### Scenario: Missing config produces exit 2 with no further diagnostics

- **Given** a process where `loadConfigFile()` cannot find the configuration
  file
- **When** the user runs `yhat-mcp doctor`
- **Then** the process exits with exit code `2` before evaluating any other
  check
- **And** stderr names the resolved path where the file was expected
- **And** the output includes the text `yhat-mcp setup` as suggested
  remediation

### Requirement: Doctor performs a TCP probe by default

The system SHALL include in the standard suite a TCP connectivity check
against the `host` and `port` declared in the configuration, implemented with
`net.createConnection` and a `3000` ms timeout, without sending credentials or
negotiating TLS.

#### Scenario: TCP probe succeeds against a reachable host

- **Given** a configuration whose `host` and `port` endpoint accepts TCP
  connections
- **When** the user runs `yhat-mcp doctor`
- **Then** the report includes a connectivity check with status `OK` and
  duration in milliseconds

#### Scenario: TCP probe reports FAIL for refused connection

- **Given** a configuration whose `host:port` refuses connections
  (`ECONNREFUSED`)
- **When** the user runs `yhat-mcp doctor`
- **Then** the report includes that check with status `FAIL` and a sanitised
  message that names the error

#### Scenario: TCP probe reports WARN for timeout

- **Given** a configuration whose `host:port` does not respond before the
  `3000` ms threshold
- **When** the user runs `yhat-mcp doctor`
- **Then** the report includes that check with status `WARN` and a message
  that identifies the timeout

#### Scenario: The TCP probe does not send credentials

- **Given** any configuration with a secret stored in keytar
- **When** the user runs `yhat-mcp doctor`
- **Then** the probe traffic to the host does NOT contain the secret value
  nor the username

### Requirement: The credentials check is opt-in

The system SHALL expose a `--check auth` flag that, when present, adds to the
suite an additional check that runs `SELECT 1` using the secret loaded from
keytar and respects `queryTimeoutSeconds` from the configuration. Without the
flag, the subcommand SHALL NOT attempt to authenticate against the SQL Server.

#### Scenario: Auth check present and successful

- **Given** a secret stored in keytar with valid credentials for the
  configured `host:port` and a defined `queryTimeoutSeconds`
- **When** the user runs `yhat-mcp doctor --check auth`
- **Then** the report includes an authentication check with status `OK` and
  the round-trip duration in milliseconds

#### Scenario: Without the flag, the auth check is not executed

- **Given** a secret stored in keytar with valid credentials
- **When** the user runs `yhat-mcp doctor`
- **Then** the report does NOT contain any authentication check, not even
  with status `OK`

#### Scenario: Auth check present and secret absent

- **Given** keytar loadable but no secret stored
- **When** the user runs `yhat-mcp doctor --check auth`
- **Then** the report includes the authentication check with status `FAIL`
- **And** the message contains the text `credentials not stored`

#### Scenario: Auth check present and incorrect credentials

- **Given** a stored secret that does NOT authenticate against the SQL
  Server
- **When** the user runs `yhat-mcp doctor --check auth`
- **Then** the report includes the authentication check with status `FAIL`
- **And** the error message does not include the secret value

### Requirement: Doctor classifies keytar status distinctly

The system SHALL distinguish, for the keytar check, between "keytar not
loadable on a platform that requires it" (FAIL), "keytar not loadable on a
platform where the keychain is non-standard" (WARN) and "keytar loadable with
secret absent" (FAIL), following the mapping already validated in
`src/keytar.ts`.

#### Scenario: Keytar loadable and secret present

- **Given** keytar loadable and a secret stored for the configured account
- **When** the user runs `yhat-mcp doctor`
- **Then** the report includes a keytar check with status `OK`

#### Scenario: Keytar loadable and secret absent

- **Given** keytar loadable but no secret stored for the configured account
- **When** the user runs `yhat-mcp doctor`
- **Then** the report includes a keytar check with status `FAIL` with a
  message indicating that the secret is missing

#### Scenario: Keytar not loadable on a platform that requires it

- **Given** a platform that requires keytar (for example, Linux without
  `libsecret`) and keytar not loadable
- **When** the user runs `yhat-mcp doctor`
- **Then** the report includes a keytar check with status `FAIL` with an
  actionable hint about how to install the dependency

#### Scenario: Keytar not loadable on a platform with non-standard keychain

- **Given** a platform where the keychain is non-standard (for example,
  Windows on a fresh install where the user has not signed in with a
  Microsoft Account) and keytar not loadable
- **When** the user runs `yhat-mcp doctor`
- **Then** the report includes a keytar check with status `WARN` with an
  informational, non-blocking message

### Requirement: Doctor is idempotent across invocations

The system SHALL produce, apart from time-varying fields (timestamps,
durations), structurally identical reports when run twice consecutively on the
same installation.

#### Scenario: Two invocations produce the same structure

- **Given** a stable installation (no changes between invocations)
- **When** the user runs `yhat-mcp doctor` twice in a row and compares the
  resulting JSON ignoring timestamps and durations
- **Then** the two JSONs are structurally identical

#### Scenario: The TCP probe is not cached across invocations

- **Given** an endpoint that responds to a TCP probe on the first invocation
  and stops responding before the second
- **When** the user runs `yhat-mcp doctor` twice in a row
- **Then** the first invocation reports the probe with status `OK`
- **And** the second invocation reports the probe with status `FAIL` (without
  inheriting the previous result)

#### Scenario: `--check auth` does not modify the audit log

- **Given** a pre-existing audit log with known size and content
- **When** the user runs `yhat-mcp doctor --check auth` on an installation
  with valid credentials
- **Then** the audit log at the end of the run has exactly the same size and
  content as before (verifiable by hash or by the timestamp of the last event)

### Requirement: Doctor preserves the behaviour of existing subcommands

The system SHALL continue to expose, without functional changes, the
subcommands already supported by the CLI (`setup`, `start`, `install` and any
other present at the time of the change). Their existing tests SHALL keep
passing without modification.

#### Scenario: Tests for existing subcommands keep passing

- **Given** the test suite prior to the `yhat-mcp-doctor` change
- **When** `npm test` is run with the change applied
- **Then** all previously green tests stay green
- **And** no prior test is modified or removed by this change

#### Scenario: CLI help lists `doctor`

- **Given** a user that runs `yhat-mcp` without a subcommand (or
  `yhat-mcp --help`)
- **When** the dispatcher falls into the `default:` block
- **Then** the help includes a line describing `yhat-mcp doctor` and its
  optional `--check auth` flag
