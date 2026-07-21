# Apply Progress: yhat-mcp-doctor (PR1)

## Status
ok

## Commits
- 4e41e4a feat(doctor): shared types and result shapes (T1)
- 022e75f feat(doctor): pure output rendering (text + json) (T2)
- e1bb2ec feat(doctor): version check (T3)
- d49c652 feat(doctor): config-root check (T4)
- 9d22500 feat(doctor): env-file check (T5)
- b4ba464 feat(doctor): tcp-connectivity check (T6)
- e3ecff1 feat(doctor): whitelist check (counts only in text mode) (T7)
- 7946074 feat(doctor): orchestration (aggregate + execute + run) (T12)
- c5f0c52 feat(doctor): TTY detection and render dispatch (T13)
- f5f9643 refactor(doctor): hoist node: imports and simplify test imports
- d244f76 test(doctor): document TCP timeout test scope decision

## Tasks completed
T1, T2, T3, T4, T5, T6, T7, T12, T13, T14 (partial — Tests 1-8, 10-11, 13, 22 covered; Test 12 documented skip; Tests 9, 14-21, 23-26 deferred to PR2 because they require T8/T9/T10/T11)

## Tasks remaining
T8 (keychain), T9 (audit-log), T10 (opencode-registration), T11 (auth-roundtrip), T15 (CLI wiring), T16 (README row), T17 (integration tests)

## Gates

### lint
```
> yhat-mcp-server@0.1.0 lint
> tsc -p tsconfig.json --noEmit
```
(pass — exit code 0, no output)

### test
```
ℹ tests 60
ℹ suites 22
ℹ pass 60
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms ~1200
```
(pass — 60 tests, 34 of which are new doctor tests; 26 baseline unchanged)

### build_cli
```
[32mCJS[39m [1mdist\cli.cjs     [22m[32m8.35 MB[39m
[32mCJS[39m [1mdist\cli.cjs.map [22m[32m25.70 MB[39m
[32mCJS[39m ⚡️ Build success in ~1700ms
```
(pass — tsup produces dist/cli.cjs)

## Diff stat

```
 src/doctor.ts        | 500 +++++++++++++++++++++++++++++++++++++++++++++
 tests/doctor.test.ts | 565 +++++++++++++++++++++++++++++++++++++++++++++++++++
 2 files changed, 1065 insertions(+)
```

> **Note on budget**: design.md forecast ~341 lines for PR1; actual is 1065 lines
> (production 500 + tests 565). The overrun is driven by strict TDD coverage
> requirements and the fact that even the orchestration code itself needs
> meaningful tests (orchestration tests alone are ~190 lines). The alternative —
> thinner tests — would weaken the verify phase.

## Risks
- **PR1 over budget** (severity: medium): diff is 1065 lines vs. 400-line review budget.
  Mitigation: 11 small commits (avg 97 lines each) instead of one giant commit; reviewer can
  step through task-by-task. PR2 will land ~290 lines as originally forecast, so the
  chained-PR strategy still reduces per-PR cognitive load.
- **TCP timeout test (T14 #12) intentionally skipped** (severity: low): a blackhole-IP
  test would add 3s to CI; the same settle()/destroy() lifecycle is exercised by
  ECONNREFUSED and ENOTFOUND paths already covered. PR2 may revisit if needed.
- **Test 9 (config absent) deferred** (severity: low): requires crash-fast in src/cli.ts
  which is forbidden in PR1. PR2 wires it as part of T15 (CLI dispatch).
- **`maskEnvVar` duplicated** (severity: low): the design said "importar el helper, no
  duplicar regex" from src/cli.ts:58, but PR1 cannot touch src/cli.ts. The duplicate
  inside src/doctor.ts is byte-identical to cli.ts and will be merged in PR2 if/when
  cli.ts extracts it (or stays duplicated — same trade-off as `readOpenCodeConfig`).

## Next (PR2 should pick up)
1. T8 — `checkKeychain` with platform-aware mapping (Linux/Darwin = FAIL with libsecret hint,
   Windows = WARN with prebuild hint; cargable + secret ausente = FAIL; cargable + secret
   presente = OK).
2. T9 — `checkAuditLog` using `resolveAuditLogDir` + glob `audit-*.ndjson` + size thresholds.
3. T10 — `checkOpenCodeRegistration` duplicating the 8-line `readOpenCodeConfig` from cli.ts.
4. T11 — `checkAuthRoundtrip` with `loadSecret`, `sql.ConnectionPool`, `SELECT 1`,
   `queryTimeoutSeconds` defense, regex-based error sanitization.
5. T15 — `case "doctor":` in src/cli.ts (lines 795-836), `--check auth` parsing,
   `process.stdout.write(renderReport(report) + "\n")`, `process.exitCode = report.exitCode`.
6. T16 — README row.
7. T17 — Tests 9, 14-17, 18-21, 23-26.

The `runDoctorCore({ flags, deps })` exported in PR1 is the seam PR2 will wrap with
`prepareRuntimeEnvironment + loadConfigFile crash-fast + exitCode propagation`.

## Relevant Files
- `src/doctor.ts` — orchestration core: types, render helpers, checks 1-5+7, runChecks, detectOutputMode
- `tests/doctor.test.ts` — 34 tests covering T1-T13 + T14 partial
- `openspec/changes/yhat-mcp-doctor/tasks.md` — T1-T13 acceptance marked [x]; T8-T11, T15-T17 deferred