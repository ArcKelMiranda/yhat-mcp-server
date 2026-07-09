# MCP Server Specification

## Purpose

Define the stdio MCP server interface and tool routing for the Yhat MCP server.

## Domain Model

- `McpServer`: the server process.
- `ToolRequest`: `{ toolName: string; arguments: Record<string, unknown> }`.
- `ToolResponse`: `{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }`.

## Requirements

### Requirement: Server initialization

The system MUST start a stdio MCP server when the process begins.

#### Scenario: Start with valid configuration

- GIVEN a valid configuration and environment
- WHEN the process starts
- THEN the server initializes and listens on stdin

#### Scenario: Start with invalid configuration

- GIVEN an invalid configuration
- WHEN the process starts
- THEN the server exits with a non-zero status code and emits a descriptive error

### Requirement: Tool registration

The system MUST expose exactly one query tool named `yhat_query` with a JSON schema input describing the SQL query and optional parameters.

#### Scenario: List available tools

- GIVEN a running server
- WHEN the client requests the tool list
- THEN the response contains exactly one tool named `yhat_query`

### Requirement: Tool routing

The system MUST route incoming `yhat_query` calls to the query execution handler and return the result.

#### Scenario: Execute a valid query

- GIVEN a running server
- WHEN the client calls `yhat_query` with a whitelisted SELECT
- THEN the server returns a structured text response with query results

#### Scenario: Unknown tool name

- GIVEN a running server
- WHEN the client calls a tool name other than `yhat_query`
- THEN the server returns an error response indicating the tool is not found

### Requirement: Response format

The system MUST return successful query results as JSON or markdown table text and errors as plain text with `isError: true`.

#### Scenario: Successful query response

- GIVEN a query that returns rows
- WHEN the server processes the response
- THEN the content array contains a single text item with the results

#### Scenario: Error response

- GIVEN a blocked query
- WHEN the server processes the response
- THEN the content array contains a text error and `isError` is set to `true`

### Requirement: Graceful shutdown

The system SHOULD close the transport and exit cleanly when stdin closes or SIGTERM is received.

#### Scenario: Stdin close

- GIVEN a running server
- WHEN the client closes stdin
- THEN the server exits with status code 0
