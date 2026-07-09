# Config Loader Specification

## Purpose

Load and validate server configuration from YAML files with environment variable interpolation, using Zod 4 for type-safe validation.

## Domain Model

- `DatabaseConfig`: `{ host: string; port: number; name: string; user: string; passwordEnv: string; encrypt: boolean; trustServerCertificate?: boolean }`.
- `WhitelistEntry`: `{ schema: string; tables: string[]; mode: 'read_only' | 'read_write' }`.
- `RoleConfig`: `{ name: string; allowedSchemas: string[] }`.
- `LimitsConfig`: `{ maxRows: number; queryTimeoutSeconds: number; largeTableColumnThreshold?: number; largeTableRowThreshold?: number; rateLimitPerMinute?: number }`.
- `AuditConfig`: `{ logDir: string; maxSizeMb: number; maxAgeDays: number; logLevel: 'debug' | 'info' | 'warn' | 'error' }`.
- `ServerConfig`: `{ name: string; transport: 'stdio' }`.
- `Config`: the composite type validated by the Zod 4 schema.

## Requirements

### Requirement: YAML file loading

The system MUST load configuration from a YAML file path.

#### Scenario: Existing config file

- GIVEN a path to a valid YAML file
- WHEN the config loader runs
- THEN the file content is loaded

#### Scenario: Missing config file

- GIVEN a path to a non-existent YAML file
- WHEN the config loader runs
- THEN startup fails with a file-not-found error

### Requirement: Environment variable interpolation

The system MUST replace placeholders in the form `${VAR_NAME}` with the value of the corresponding environment variable.

#### Scenario: Password from environment

- GIVEN a YAML value `password_env: ${YHAT_DB_PASSWORD}`
- WHEN the environment variable is set
- THEN the loaded config contains the resolved value

#### Scenario: Missing environment variable

- GIVEN a YAML value referencing `${YHAT_DB_PASSWORD}`
- WHEN the environment variable is not set
- THEN startup fails with a clear error message

### Requirement: Zod 4 schema validation

The system MUST validate the interpolated configuration with a Zod 4 schema.

#### Scenario: Valid config

- GIVEN a YAML file matching the schema
- WHEN the loader parses it
- THEN the typed `Config` object is returned

#### Scenario: Invalid config

- GIVEN a YAML file missing the `database` section
- WHEN the loader parses it
- THEN validation fails with a descriptive error

### Requirement: Fast failure

The system MUST terminate startup with a non-zero exit code and a clear error when configuration is invalid.

#### Scenario: Invalid port

- GIVEN a configuration with `database.port: 70000`
- WHEN the server starts
- THEN the process exits with a validation error

### Requirement: Secret exclusion

The system MUST NOT accept database secrets in the YAML file; secrets MUST be resolved from environment variables.

#### Scenario: Literal password in YAML

- GIVEN a YAML file containing `password: PlainTextPassword`
- WHEN the loader validates it
- THEN validation fails with a secret-in-config error

### Requirement: Sensible defaults

The system SHOULD provide default values for optional configuration settings.

#### Scenario: Missing optional log level

- GIVEN a config without `audit.logLevel`
- WHEN the loader parses it
- THEN the default value `info` is used

### Requirement: Environment-specific config

The system MAY support selecting a configuration file based on an environment variable.

#### Scenario: Production environment

- GIVEN `YHAT_ENV=prod`
- WHEN the server starts
- THEN it loads `config/yhat-mcp-config.prod.yaml` instead of the default file
