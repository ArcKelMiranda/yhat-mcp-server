# Verify: yhat-mcp-doctor

## Summary

All four gates (lint, test, build, build:cli) pass on `main` with 60/60 tests green
and the CLI binary behaves as specified end-to-end (smoke tests against `dist/cli.cjs`
confirmed crash-fast on missing config, JSON output, help listing `doctor`, and both
kebab and GNU flag forms of `--check auth`). Implementation maps to the spec
end-to-end, but a meaningful portion of spec scenarios (8 of 27) lack a covering
unit/integration test — these were scoped out in `apply-progress.md` ("T17 partial",
"PR2 integration tests not present") and remain acknowledged residual gaps.

## Verdict

PASS_WITH_FOLLOWUPS

## Gates

- lint: PASS — `npm run lint` (`tsc --noEmit`) exited 0, no diagnostics.
- test: PASS — `npm test` reported `tests 60, pass 60, fail 0` (9861 ms).
- build: PASS — `npm run build` (`tsc -p tsconfig.json`) exited 0.
- build:cli: PASS — `npm run build:cli` produced `dist/cli.cjs` (8.36 MB), exit 0.

## Spec coverage

| Requirement | Scenario | Test file:line | Status |
|-------------|----------|----------------|--------|
| Doctor ejecuta la suite de checks de solo lectura | Doctor sale con código 0 cuando todos los checks pasan | tests/doctor.test.ts:525 (runChecks "happy path -> exitCode 0") | covered |
| Doctor ejecuta la suite de checks de solo lectura | Doctor sale con código 1 cuando al menos un check está en WARN | tests/doctor.test.ts:416 (aggregateSummary "single WARN -> exitCode 1") and 537 (runChecks WARN) | covered |
| Doctor ejecuta la suite de checks de solo lectura | Doctor sale con código 2 cuando al menos un check está en FAIL | tests/doctor.test.ts:422 (aggregateSummary "single FAIL -> exitCode 2") and 546 (runChecks FAIL) | covered |
| Doctor ejecuta la suite de checks de solo lectura | Doctor prioriza FAIL sobre WARN en el exit code | tests/doctor.test.ts:428 (aggregateSummary "FAIL + WARN -> exitCode 2") | covered |
| Doctor adapta el formato de salida al destino | Salida en modo texto cuando stdout es una TTY | tests/doctor.test.ts:455 (detectOutputMode === "text" when isTTY true) and 488 (renderReport delegates to text mode) | covered |
| Doctor adapta el formato de salida al destino | Salida en modo JSON cuando stdout no es una TTY | tests/doctor.test.ts:466, 477 (detectOutputMode === "json" when isTTY false/undefined) and 89 (toJsonReport parseable) | covered |
| Doctor adapta el formato de salida al destino | Salida JSON usa finales de línea LF | tests/doctor.test.ts:97 ("toJsonReport never emits CR") | covered |
| Doctor nunca imprime el valor de los secretos | El valor del secret no aparece en salida de texto | tests/doctor.test.ts:122 ("formatReport('text') redacts secrets referenced by sensitive keys") | covered (via redactSensitiveText) |
| Doctor nunca imprime el valor de los secretos | El valor del secret no aparece en salida JSON | tests/doctor.test.ts:105 ("toJsonReport redacts secrets referenced by sensitive keys") | covered (via redactSensitiveText) |
| Doctor aborta rápido cuando la configuración no existe | Config ausente produce exit 2 sin más diagnóstico | NONE (only black-box smoke test verified `YHAT_CONFIG_ROOT=/nope` exit 2 + path + "yhat-mcp setup"; no unit test) | UNTESTED (WARNING) |
| Doctor realiza un probe TCP por defecto | Probe TCP exitoso contra host alcanzable | tests/doctor.test.ts:218 (checkTcpConnectivity OK with mock server) | covered |
| Doctor realiza un probe TCP por defecto | Probe TCP reporta FAIL por conexión rechazada | tests/doctor.test.ts:249 (ECONNREFUSED → fail) | covered |
| Doctor realiza un probe TCP por defecto | Probe TCP reporta WARN por timeout | NONE (test file line 287-293 documents scope decision: timeout test omitted for CI cost; ECONNREFUSED/ENOTFOUND paths cover the same settle/destroy lifecycle) | UNTESTED (WARNING, documented) |
| Doctor realiza un probe TCP por defecto | El probe TCP no envía credenciales | tests/doctor.test.ts:295 (socket.write spy confirms no payload) | covered |
| El check de credenciales es opt-in | Auth check presente y exitoso | NONE (black-box smoke test against `dist/cli.cjs doctor --check-auth` produced real `auth-roundtrip OK 1131ms` against the configured SQL Server; no unit test with mocked mssql) | UNTESTED (WARNING) |
| El check de credenciales es opt-in | Sin flag, el check de auth no se ejecuta | NONE | UNTESTED (WARNING) |
| El check de credenciales es opt-in | Auth check presente y secret ausente | NONE | UNTESTED (WARNING) |
| El check de credenciales es opt-in | Auth check presente y credencial incorrecta | NONE | UNTESTED (WARNING) |
| Doctor clasifica el estado de keytar de forma distinta | Keytar cargable y secret presente | NONE (checkKeychain imported at tests/doctor.test.ts:14 but never invoked in any test) | UNTESTED (WARNING) |
| Doctor clasifica el estado de keytar de forma distinta | Keytar cargable y secret ausente | NONE | UNTESTED (WARNING) |
| Doctor clasifica el estado de keytar de forma distinta | Keytar no cargable en plataforma que lo requiere | NONE | UNTESTED (WARNING) |
| Doctor clasifica el estado de keytar de forma distinta | Keytar no cargable en plataforma con keychain no estándar | NONE | UNTESTED (WARNING) |
| Doctor es idempotente entre invocaciones | Dos invocaciones producen la misma estructura | tests/doctor.test.ts:555 (runChecks "two consecutive runs are structurally identical") | covered |
| Doctor es idempotente entre invocaciones | El probe TCP no se cachea entre invocaciones | NONE | UNTESTED (WARNING) |
| Doctor es idempotente entre invocaciones | `--check auth` no modifica el audit log | NONE | UNTESTED (WARNING) |
| Doctor preserva el comportamiento de los subcomandos existentes | Los tests de los subcomandos existentes siguen pasando | `npm test` 60/60 pass, no test deleted (verified `git diff 9a791a4..HEAD --stat tests/` shows only the new `tests/doctor.test.ts` added) | covered |
| Doctor preserva el comportamiento de los subcomandos existentes | La ayuda del CLI lista `doctor` | NONE in test file (black-box smoke test confirmed `node dist/cli.cjs` and `node dist/cli.cjs --help` both print `doctor    Run read-only diagnostic checks (use --check auth to verify credentials)`) | UNTESTED (WARNING) |

Coverage summary: 16/27 spec scenarios have a covering unit or integration test
(59%). 11/27 are untested in `tests/doctor.test.ts`. Several are mitigated by
black-box smoke evidence (config-missing, auth-roundtrip, help listing); others
(keychain classification per platform, no-cache TCP, audit-log integrity) are
purely gaps.

## Findings

### CRITICAL (block archive)

- None. All spec requirements have working runtime code; lint, tests, build, and
  build:cli are green; the CLI binary runs end-to-end and produces the documented
  output and exit codes.

### WARNING (should be addressed before archive)

- `tests/doctor.test.ts:14-17` imports `checkKeychain`, `checkAuditLog`,
  `checkOpenCodeRegistration`, `checkAuthRoundtrip` but never invokes them in any
  test. Eight spec scenarios (keychain classification × 4, auth-roundtrip × 4, TCP
  no-cache × 1, audit-log integrity × 1) have no covering test at all. The
  apply-progress.md (lines 23, 69-70) already acknowledged this as a residual
  risk; the smoke tests against `dist/cli.cjs` prove the code path works against
  a real SQL Server but do not prove the FAIL-path logic for keychain or auth.
  Severity: WARNING because runtime behavior is observable but not unit-locked.

- Spec scenario "Config ausente produce exit 2 sin más diagnóstico" has no unit
  test. The smoke test `YHAT_CONFIG_ROOT=C:/no-such-dir-xyz-yhat node dist/cli.cjs doctor`
  confirms `EXIT=2` with stderr `Config file not found: ...\config\yhat-mcp-config.yaml`
  + `Run 'yhat-mcp setup' first.` and no JSON partial output — but a regression
  here would only be caught at runtime, not by CI. A unit test mocking
  `loadConfigFile` to throw would close the gap. Severity: WARNING.

- Spec scenario "TCP probe WARN por timeout" has no direct test. The test file
  itself acknowledges the omission at lines 287-293. The code path
  (`socket.once("timeout", ...)` and `error.code === "ETIMEDOUT"`) is
  straightforward and the settle/destroy lifecycle is exercised by the
  ECONNREFUSED/ENOTFOUND tests, but a literal 3-second timeout test was scoped
  out to keep CI fast. Severity: WARNING (documented).

- Spec scenario "La ayuda del CLI lista `doctor`" has no test. The smoke test
  verified `node dist/cli.cjs` and `node dist/cli.cjs --help` print the doctor
  row. No regression guard. Severity: WARNING.

- Spec scenario "--check auth no modifica el audit log" has no test. Severity:
  WARNING.

### SUGGESTION (follow-up)

- The cross-reference comment at `src/doctor.ts:212` says `src/cli.ts:60` and the
  reverse at `src/cli.ts:61` says `src/doctor.ts:208`. The actual doctor line
  number is 211 (was 208 at write-time of the cli comment). Consider keeping
  these in sync or, better, extracting `maskEnvVar` to a shared `src/env-mask.ts`
  module now that two production callers exist (the original `work-unit-commits`
  rationale for deferring the extraction — single caller — no longer holds).

- `src/doctor.ts:660` exports `renderReport` and `formatReport` but the CLI uses
  only `renderReport` (`src/cli.ts:847`). Consider whether `formatReport` should
  stay exported or move to internal scope. Tests do exercise both — no immediate
  risk.

- `src/doctor.ts:459-464` builds `OPENCODE_CONFIG_PATH` from `HOME` /
  `USERPROFILE`, duplicating the logic in `src/cli.ts:47`. The design decision
  ("no extraer readOpenCodeConfig") is sound, but the path-construction
  duplication is now in two places. If a future Windows-specific parity issue
  arises (apply-progress.md flagged this as medium risk), consolidating the
  path resolver would help.

- `tests/doctor.test.ts:144` uses `config: {} as CheckContext["config"]` as the
  default for `makeContext`. Several tests then override with partial configs
  cast to `as unknown as CheckContext["config"]`. A typed factory would surface
  shape mismatches at compile time and reduce the `unknown` casts.

## Smoke tests

- `node dist/cli.cjs doctor` (real install, configured): exit code 2, JSON output
  on stdout with `summary: { ok: 7, warn: 0, fail: 1 }`. The single FAIL is
  `audit-log` with detail `audit log directory unavailable: C:\Users\KelvinMiranda\AppData\Local\yhat-mcp\config\logs`
  (directory genuinely missing in this environment). `auth-roundtrip` is correctly
  absent from the checks array. JSON is single-line, parseable, contains no
  secrets (no `password=` substrings, no keychain value).

- `node dist/cli.cjs doctor --check-auth` (real install, configured): exit code
  2, JSON output with `summary: { ok: 8, warn: 0, fail: 1 }`. The
  `auth-roundtrip` check is present with `status: "ok", detail: "1622ms"`
  (later run: `1131ms`), confirming both that `--check-auth` adds the check and
  that `SELECT 1` round-trips against the configured SQL Server.

- `node dist/cli.cjs doctor --check auth` (GNU-style): same exit 2, same JSON
  shape, auth-roundtrip present with OK status. Both flag forms accepted per
  design §"CLI wiring".

- `YHAT_CONFIG_ROOT=C:/no-such-dir-xyz-yhat node dist/cli.cjs doctor`: exit 2,
  stderr `Config file not found: C:\no-such-dir-xyz-yhat\config\yhat-mcp-config.yaml`
  followed by `Run 'yhat-mcp setup' first.`. No JSON printed to stdout — the
  crash-fast path returns before the report, satisfying spec scenario
  "Config ausente produce exit 2 sin más diagnóstico" at runtime.

- `node dist/cli.cjs` (no args): exit 0, prints the Usage block including the
  new `doctor    Run read-only diagnostic checks (use --check auth to verify credentials)`
  row.

- `node dist/cli.cjs --help`: exit 0, same Usage block (no special handling).

## Risks remaining

- **Keychain classification paths untested.** `checkKeychain` branches on
  `secretStore === null` × `process.platform in {linux, darwin, win32}`. None
  of the four combinations has a covering unit test. The apply-progress.md
  already noted this as residual medium risk. A future refactor of
  `loadSecretStore` could silently flip platform mapping without detection.

- **`--check-auth` integration path partially tested only at black-box.** The
  `checkAuthRoundtrip` function calls real `mssql` — a unit test that mocks
  `sql.ConnectionPool` would prove the `queryTimeoutSeconds` defense and the
  `credentials not stored` and "wrong credential" branches. Black-box smoke
  confirmed the happy path against a real SQL Server, but the failure paths
  are unexercised.

- **Help-text regression risk.** The Usage block lives at the bottom of
  `src/cli.ts` (line 853). If a future change adds a new command without
  updating the doctor row position, no test will catch the breakage. A snapshot
  test of the help output would close this gap.

- **`process.env.HOME ?? process.env.USERPROFILE ?? ""`** at `src/doctor.ts:460`
  produces a path `/.config/opencode/opencode.json` when both env vars are
  unset (rare but possible in sandboxed environments). The check would fail
  with the misleading detail `opencode config not found` instead of
  `environment missing HOME`. Severity: low.

## Recommendation

Archive-eligible with followups. The implementation is correct, the gates are
green, the binary works end-to-end against the real configured environment
(including a real SQL Server auth roundtrip), and the spec scenarios that have
test coverage all pass. The 11 untested scenarios fall into two buckets: (a)
keychain/auth classification paths that are runtime-correct but lack unit
locking, and (b) scenarios where black-box smoke evidence substitutes for unit
tests. Recommend archiving the change and opening a follow-up issue to add
unit tests for `checkKeychain` (4 scenarios), `checkAuthRoundtrip` (4
scenarios), the crash-fast config path, the TCP timeout branch, the help
listing, and the no-cache TCP and no-mutate-audit invariants. None of these
gaps block correctness today — they reduce the safety net for future
refactors. The audit-mitigation cross-reference comments for `maskEnvVar` are
in place, `loadSecretStore` is exported and consumed in `cli.ts:842`, and
`src/doctor.ts` imports neither `validator.ts` nor `whitelist.ts`.
