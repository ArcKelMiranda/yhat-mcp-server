# Archive: yhat-mcp-doctor

## Verdict

PASS

## Summary

The `yhat-mcp doctor` subcommand shipped to `main` via three chained PRs
(PR1 core + checks, PR2 surface + CLI wiring, PR3 coverage work) with 20
commits and 71/71 tests green across 27 suites. All four verification gates
pass (lint, test, build, build:cli), the CLI binary behaves end-to-end
against a real configured SQL Server, and the verify report returns
`PASS_WITH_FOLLOWUPS` with 0 CRITICAL findings. Spec scenarios now have
unit-locked coverage for 23 of 27; the remaining four are covered by
documented black-box smoke evidence (config-absent, keychain platform
classification by environment, audit-log no-mutation, no-cache TCP).

## Artifacts archived

- proposal.md
- specs/cli-diagnostics/spec.md
- design.md
- tasks.md
- apply-progress.md
- verify-report.md
- archive-report.md (this file)

## Spec sync

Capability `cli-diagnostics` was created under `openspec/specs/` at
`openspec/specs/cli-diagnostics/spec.md`. No prior main spec existed, so
the delta was promoted to a full capability spec verbatim (Purpose + 9
Requirements + 27 Scenarios). Delta spec retained in the archive bundle for
audit. Future changes can build additional `### Requirement:` blocks on top
of this capability using OpenSpec `&&` chaining.

## Commits shipped

### PR1 — Doctor core (13 commits, ~340 lines)
- 4e41e4a feat(doctor): shared types and result shapes (T1)
- 022e75f feat(doctor): pure output rendering (text + json) (T2)
- e1bb2ec feat(doctor): version check (T3)
- d49c652 feat(doctor): config-root check (T4)
- 9d22500 feat(doctor): env-file check (T5)
- b4ba464 feat(doctor): tcp-connectivity check (T6)
- e3ecff1 feat(doctor): whitelist check (T7)
- 7946074 feat(doctor): orchestration (aggregate + execute + run) (T12)
- c5f0c52 feat(doctor): TTY detection and render dispatch (T13)
- f5f9643 refactor(doctor): hoist node imports and simplify test imports
- d244f76 test(doctor): document TCP timeout test scope decision
- 7b63660 docs(doctor): PR1 apply-progress and tasks checkbox update
- 4e31098 feat(doctor): record PR2 apply progress

### PR2 — Doctor surface (3 commits, ~290 lines)
- 23266bf feat(doctor): add keychain audit opencode and auth checks (T8-T11)
- 96fd98d feat(doctor): wire diagnostic command and help (T15-T16)
- 160b3ca fix(doctor): inject real SecretStore in CLI wiring

### PR3 — Coverage work (4 commits, post-verify follow-ups)
- 7b7efff test(doctor): cover keychain classification scenarios
- 40ed33c test(doctor): cover auth-roundtrip scenarios with mocked mssql
- 3c0c509 test(doctor): cover config-absent and TCP no-cache integration
- 26737c7 test(doctor): cover auth-no-mutation-audit scenario

## Test delta

- Before: 60 tests across 23 suites (post-PR2 baseline).
- After: 71 tests across 27 suites (post-PR3 coverage work).
- Net: +11 tests, +4 suites, +1,532 ms of test duration.
- Coverage: PR2 left 16/27 spec scenarios with unit-locked tests (59%);
  PR3 added dedicated unit tests for 7 of the 11 WARNING scenarios, raising
  unit-locked coverage to 23/27 (85%). The remaining 4 scenarios have
  black-box smoke evidence recorded in `verify-report.md`.

## Residual follow-ups (non-blocking)

- 4 spec scenarios remain without a UNIT test but have documented black-box
  smoke evidence:
  - "Auth check presente y exitoso" — verified end-to-end against real SQL
    Server (smoke: `dist/cli.cjs doctor --check-auth` returned
    `auth-roundtrip OK 1131ms`).
  - "Sin flag, el check de auth no se ejecuta" — verified by smoke that
    `report.checks` excludes `auth-roundtrip` when flag absent.
  - "Los tests de los subcomandos existentes siguen pasando" — covered by
    the unchanged green baseline (60/60 pre-PR3).
  - "La ayuda del CLI lista `doctor`" — verified by smoke against
    `dist/cli.cjs` and `dist/cli.cjs --help`.

  Future PRs can add deterministic unit tests for these without reopening
  the archive; no spec change is needed.

- TCP probe WARN-by-timeout branch has no direct deterministic test
  (3-second timer). The settle/destroy lifecycle is exercised by the
  ECONNREFUSED / ENOTFOUND paths, so the lifecycle code is covered even
  though the literal `error.code === "ETIMEDOUT"` branch is not. A future
  PR using `node:test` timers or a fake clock can close this gap.

- `maskEnvVar` is duplicated between `src/cli.ts` and `src/doctor.ts` (with
  cross-reference comments). With two production callers the original
  "single caller" rationale no longer holds; a follow-up could extract it
  to a shared `src/env-mask.ts`. Trivial refactor, no spec change required.

- `process.env.HOME ?? process.env.USERPROFILE ?? ""` at `src/doctor.ts:460`
  can produce a malformed path when both env vars are unset. Severity: low.
  Suggested remediation: detect and report `environment missing HOME` instead
  of the misleading `opencode config not found`.

- The audit-log directory check reports FAIL on environments where `logs/`
  has never been written (the current dev box). This is correct behaviour
  for production but produces a confusing WARN for a first-run developer.
  Not a feature bug; documentation only.

## Recommendation

The change is archived. The `cli-diagnostics` capability is now part of
the main spec under `openspec/specs/cli-diagnostics/spec.md` and serves as
the source of truth for future changes. No further action is required to
complete the SDD cycle for `yhat-mcp-doctor`.

The follow-ups above are explicitly out of scope for this archive and can
be addressed by future changes without reopening it.
