# SDD Init — MCP_SQLServer

> Detected: 2026-07-09
> Source: project PRD (`prd_extracted.txt`, `Yhat_MCP_Server_PRD_v1.1.docx`)
> Phase executor: sdd-init

## Project Identity

- **Project name**: MCP_SQLServer
- **Display name**: Yhat MCP Server
- **Purpose**: Secure, auditable SQL Server access for AI assistants via Model Context Protocol (MCP)
- **Maturity**: PRD stage; no source code or package manifest has been scaffolded yet.

## Detected Stack

| Layer | Value | Evidence |
|-------|-------|----------|
| Language | Python 3.10+ | PRD section 8 (Stack Tecnológico), NFR-06 |
| Runtime | CPython (local) / Docker (optional) | PRD sections 6.3, 8 |
| Framework | `mcp` — Anthropic official SDK | PRD section 8 |
| Transport | stdio or SSE | PRD section 6.1, FR-01 |
| Database | SQL Server via `pyodbc` + `SQLAlchemy` | PRD section 8, FR-02 |
| Configuration | PyYAML + Pydantic | PRD section 8 |
| Secrets | Environment variables / AWS Secrets Manager | PRD section 7, FR-17, FR-27 |
| Logging | Python `logging` + `loguru` | PRD section 8 |
| Packaging | `uv` (preferred) / `pip` fallback | PRD section 8 |
| Containerization | Docker (optional) | PRD section 8, FR-26 |

## Detected Conventions

- **Project layout** (planned, from PRD section 6.3):
  ```
  yhat-mcp-server/
  ├── yhat_mcp/           # Main package (snake_case)
  │   ├── __init__.py
  │   ├── server.py       # Entry point
  │   ├── config.py       # YAML + env loading
  │   ├── secrets.py      # Credential resolution
  │   ├── validator.py    # Query Guard
  │   ├── database.py     # SQL Server connection layer
  │   ├── audit.py        # Logging
  │   ├── rbac.py         # Roles & permissions
  │   └── models.py       # Pydantic models
  ├── config/
  │   └── yhat-mcp-config.yaml
  ├── tests/
  ├── logs/               # Gitignored
  ├── Dockerfile
  ├── requirements.txt
  ├── pyproject.toml
  ├── Makefile
  └── README.md
  ```
- **Naming**: Python `snake_case` for modules, classes, functions, and variables (inferred from proposed structure).
- **Configuration**: YAML-driven, environment-variable placeholders for secrets (`${VAR}` style).
- **No lint/format/type-check config detected**: no `.pre-commit-config.yaml`, `ruff.toml`, `pyproject.toml`, `setup.cfg`, or `mypy.ini` exists yet.

## Detected Architecture Patterns

- **Layered security pipeline** (PRD section 6.2):
  1. Client MCP request
  2. Translation (LLM SQL or direct SQL)
  3. Validation (Query Guard: RBAC, whitelist, destructive-op rules)
  4. Execution (parameterized queries, timeout, row limit)
  5. Audit logging (metadata only, no result data)
  6. Response to LLM
- **Core components**:
  - `validator.py` — Query Guard
  - `rbac.py` — Role-based access control (reader / writer / admin)
  - `audit.py` — Audit logging
  - `database.py` — Connection abstraction
  - `config.py` / `secrets.py` — Configuration & secret resolution
- **Non-objectives for v1**: no DDL, no BI replacement, no custom GUI, no cloud lock-in.

## Testing Capabilities

See `openspec/config.yaml` `testing:` block and Engram topic `sdd/MCP_SQLServer/testing-capabilities` for the structured summary.

- **Current state**: no test runner, no tests, no coverage tooling installed.
- **Planned capability** (from PRD): `pytest` + `pytest-asyncio` for async tests, target coverage >80% (NFR-05), CI in a later roadmap phase.
- **Strict TDD**: currently unsupported (`false`) because no test runner or testable code exists.

## Risks & Observations

- **CRITICAL**: Project is at PRD stage only; no `pyproject.toml`, `requirements.txt`, `Makefile`, or source code exists yet. SDD downstream phases (propose/spec/design/apply) must first scaffold the project.
- **WARNING**: No linter, formatter, or type checker configured. Recommend adding `ruff` (lint+format) and `mypy` before heavy implementation.
- **SUGGESTION**: Security-focused project; consider establishing a `security/` test suite early (injection attempts, destructive query blocks, audit metadata verification).
- **SUGGESTION**: The PRD already provides acceptance criteria and functional requirements; a good next SDD phase is `sdd-explore` to map the PRD into a concrete change proposal, or `sdd-new` if the orchestrator wants to start a named change immediately.

## Next Recommended Phase

`sdd-explore` — map the PRD into candidate changes and select the first change to drive through the SDD pipeline (likely the Phase 1 MVP: scaffold + basic read-only MCP server).

## Artifact Store

- **OpenSpec**: `openspec/config.yaml` and this file (`openspec/init/sdd-init-MCP_SQLServer.md`) are the authoritative local artifacts.
- **Engram**: `sdd-init/MCP_SQLServer`, `sdd/MCP_SQLServer/testing-capabilities`, and `skill-registry` observations.
