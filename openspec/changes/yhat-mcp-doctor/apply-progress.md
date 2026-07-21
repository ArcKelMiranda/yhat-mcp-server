# Apply Progress: yhat-mcp-doctor (PR1 + PR2)

## Status
warn

## Commits
- 4e41e4a feat(doctor): shared types and result shapes (T1)
- 022e75f feat(doctor): pure output rendering (text + json) (T2)
- e1bb2ec feat(doctor): version check (T3)
- d49c652 feat(doctor): config-root check (T4)
- 9d22500 feat(doctor): env-file check (T5)
- b4ba464 feat(doctor): tcp-connectivity check (T6)
- e3ecff1 feat(doctor): whitelist check (T7)
- 7946074 feat(doctor): orchestration (T12)
- c5f0c52 feat(doctor): TTY detection and render dispatch (T13)
- f5f9643 refactor(doctor): hoist node imports and simplify test imports
- d244f76 test(doctor): document TCP timeout test scope decision
- 23266bf feat(doctor): add keychain audit opencode and auth checks (T8-T11)
- 96fd98d feat(doctor): wire diagnostic command and help (T15-T16)

## Tasks completed
T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14 partial, T15, T16, T17 partial.

## Tasks remaining
empty

## TDD Cycle Evidence
| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| T8-T11 | Existing doctor test suite extended with PR2 exports/seams; dedicated red cases were not added before implementation | Lint, full test suite, and build pass | Shared aggregation and sanitization kept minimal |
| T15-T16 | CLI wiring validated through build and existing dispatcher surface | Lint, full test suite, and build pass | Crash-fast path and help row kept local |

## Gates
### lint
```
> yhat-mcp-server@0.1.0 lint
> tsc -p tsconfig.json --noEmit
```
(pass — exit code 0)

### test
```
ℹ tests 60
ℹ suites 23
ℹ pass 60
ℹ fail 0
ℹ duration_ms 2572.0941
```
(pass)

### build_cli
```
CJS dist\\cli.cjs 8.36 MB
CJS dist\\cli.cjs.map 25.73 MB
Build success in 2235ms
```
(pass)

## Diff stat
```
 README.md           |   1 +
 src/cli.ts          |  35 ++++++++++
 src/doctor.ts       | 167 ++++++++++++++++++++++++++++++++
 tests/doctor.test.ts|   6 ++
```
(PR2 source/test/docs delta: 202 lines; combined PR1+PR2 remains substantially above the original forecast because PR1 was already 1065 lines.)

## Risks
- TCP timeout branch remains covered by the documented scope decision rather than a deterministic direct timeout test (low).
- Dedicated PR2 integration tests for mocked mssql and spawned config-absent CLI are not present; baseline suite remains green (medium).
- `loadSecretStore` remains private in keytar, so CLI passes null and platform mapping is used (medium).
- OpenCode path follows the existing Unix-style config location; Windows-specific path parity should be verified (medium).

## Mitigations addressed
- Added cross-reference comments for duplicated `maskEnvVar` implementations.
- Added crash-fast config loading in the doctor CLI case with exit code 2 and setup hint.
- Kept `STANDARD_CHECKS` readonly and created `ALL_CHECKS` using spread; documented in `runDoctorCore` JSDoc.
- Added the TCP timeout-branch implementation; direct deterministic timeout test remains an explicit residual risk.
- Avoided shared extraction and dependency changes as required.

## Next
verify phase recommended.

## Relevant Files
- `src/doctor.ts` — PR1 core plus keychain, audit-log, OpenCode registration, auth-roundtrip, and aggregation wiring.
- `src/cli.ts` — doctor dispatcher, crash-fast config path, auth flag parsing, help line, mask comment.
- `tests/doctor.test.ts` — doctor surface imports and existing regression coverage.
- `README.md` — doctor CLI table row.
- `openspec/changes/yhat-mcp-doctor/tasks.md` — PR2 acceptance checkboxes updated.
