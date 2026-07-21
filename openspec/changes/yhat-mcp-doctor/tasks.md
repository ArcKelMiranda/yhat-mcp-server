# Tasks: yhat-mcp-doctor

> Implementación en orden estricto. Cada tarea lista sus dependencias,
> archivos tocados, estimación de diff y aceptación booleana. Los IDs
> `1.x`–`10.x` mapean a los checks del design; `T1`–`T9` son tareas
> transversales. El corte PR1/PR2 está cerrado en `design.md` y se respeta
> aquí para mantener cada PR bajo el budget de 400 líneas y con tests que
> viajan con el código que verifican (regla `work-unit-commits`).

## PR Plan

**PR1 — Doctor core** (target ~340 líneas, código + tests):

- T1 Tipos y formas compartidas
- T2 Helpers puros `formatReport` y `toJsonReport`
- T3 Check `version`
- T4 Check `config-root`
- T5 Check `env-file`
- T6 Check `tcp-connectivity`
- T7 Check `whitelist`
- T12 Orquestación `runDoctor({ flags, deps })`
- T13 Detección TTY + dispatch de render
- T14 Tests de los checks 1–5,7 y de los helpers de render

> PR1 deja el módulo `src/doctor.ts` listo para ser consumido por el CLI,
> pero NO toca `src/cli.ts`. La superficie exportada se valida con tests
> unitarios. `npm run lint`, `npm test` (incluyendo los nuevos) y
> `npm run build:cli` quedan verdes sin que el comando esté cableado.

**PR2 — Doctor surface** (target ~290 líneas, código + tests + docs):

- T8 Check `keychain`
- T9 Check `audit-log`
- T10 Check `opencode-registration`
- T11 Check `auth-roundtrip` (opt-in)
- T15 CLI wiring (`case "doctor":` + ayuda)
- T16 Fila de README
- T17 Tests de los checks 6, 8, 9, 10 y de los escenarios de integración

> PR2 cierra el ciclo: cablea el dispatch, agrega los checks faltantes y
> sus tests, deja la fila en README. Después de PR2, `npm run lint`,
> `npm test` y `npm run build:cli` siguen verdes, y `yhat-mcp doctor`
> ya es ejecutable.

## Constraints baked-in

- Sin nuevas dependencias (`package.json` intacto).
- Sin tocar `CHANGELOG.md`, validator, whitelist, audit logger, connection pool.
- `Config` se infiere de `src/types.ts` (si apply ve mismatch, switch a
  `Awaited<ReturnType<typeof loadConfigFile>>`).
- `process.exitCode = N`, nunca `process.exit(N)`.
- `readOpenCodeConfig` se duplica en `src/doctor.ts` (8 líneas), no se
  extrae.
- Sin iconos en text mode (encoding Windows console).
- `--check auth` se invoca con `--check-auth` o `--check auth`.

---

## Tasks

### T1 — Tipos y formas compartidas en `src/doctor.ts`

- **Depends on**: none
- **Files**: `src/doctor.ts` (create, partial)
- **Estimated diff**: ~35 líneas
- **Acceptance**:
  - [x] Exporta `CheckStatus = "ok" | "warn" | "fail"`
  - [x] Exporta `CheckResult`, `CheckContext`, `Check`, `DoctorReport` con la forma del design
  - [x] `CheckContext.config` usa `Config` de `src/types.ts`
  - [x] `CheckContext.secretStore` usa el tipo `SecretStore` (o la interfaz pública equivalente) de `src/keytar.ts`
  - [x] `DoctorReport.exitCode` es el union literal `0 | 1 | 2`
  - [x] `npm run lint` pasa con el módulo nuevo importable y sin `any` implícito
- **Maps to spec scenarios**: (transversal — soporta todos los requirements)

### T2 — Helpers puros `formatReport` y `toJsonReport`

- **Depends on**: T1
- **Files**: `src/doctor.ts`
- **Estimated diff**: ~50 líneas
- **Acceptance**:
  - [x] `formatReport(report, "text")` retorna tabla 78 columnas con header `CHECK | STATUS | DETAIL` y footer `Summary: N OK, M WARN, K FAIL — exit N`
  - [x] `formatReport(report, "text")` NO incluye nombres de schema/tabla del check `whitelist` (solo counts)
  - [x] `toJsonReport(report)` retorna `JSON.stringify(report)` en una sola línea
  - [x] `toJsonReport` produce string sin bytes `0x0D` (CR) aunque `os.EOL === "\r\n"`
  - [x] Ambos helpers son funciones puras (sin tocar `process.stdout`)
  - [x] El footer del text mode repite el `exitCode` exacto del `DoctorReport`
- **Maps to spec scenarios**: "Salida en modo texto cuando stdout es una TTY", "Salida en modo JSON cuando stdout no es una TTY", "Salida JSON usa finales de línea LF"

### T3 — Check `version`

- **Depends on**: T1
- **Files**: `src/doctor.ts`
- **Estimated diff**: ~12 líneas
- **Acceptance**:
  - [x] Lee `package.json` con `readFile("./package.json", "utf8")` y extrae `version`
  - [x] Captura `process.version`, `process.platform`, `process.arch`
  - [x] Retorna siempre `{ status: "ok", data: { pkg, node, platform, arch } }`
  - [x] `pkg` en `data` es `"yhat-mcp-server"` (constante, no del package)
- **Maps to spec scenarios**: "Doctor sale con código 0 cuando todos los checks pasan" (happy path depende de este check)

### T4 — Check `config-root`

- **Depends on**: T1
- **Files**: `src/doctor.ts`
- **Estimated diff**: ~14 líneas
- **Acceptance**:
  - [x] Usa `getConfigRoot()` desde `src/paths.ts` (sin redefinir lógica)
  - [x] `access(F_OK)` → no existe → `fail` con `detail: "config root not found: <path>"`
  - [x] `access(W_OK)` → no escribible → `warn` con `detail: "config root not writable: <path>"`
  - [x] Existe y escribible → `ok` con `detail: <path>`
- **Maps to spec scenarios**: "Doctor sale con código 0 cuando todos los checks pasan" (happy path), "Doctor sale con código 2 cuando al menos un check está en FAIL"

### T5 — Check `env-file`

- **Depends on**: T1
- **Files**: `src/doctor.ts`
- **Estimated diff**: ~20 líneas
- **Acceptance**:
  - [x] Lee `envPath` con el helper de `cli.ts:67` (o lo extrae sin tocar cli.ts)
  - [x] Verifica que las claves `YHAT_DB_HOST`, `YHAT_DB_PORT`, `YHAT_DB_NAME`, `YHAT_DB_USER` estén presentes
  - [x] Reporta usando `maskEnvVar` desde `src/cli.ts:58` (importar el helper, no duplicar regex)
  - [x] No imprime el valor de `YHAT_DB_PASSWORD_ENV` ni el valor real del secret
  - [x] `fail` solo si el archivo no existe; `warn` si falta alguna clave no-secreto; `ok` si todas están
- **Maps to spec scenarios**: "Doctor sale con código 0 cuando todos los checks pasan", "El valor del secret no aparece en salida de texto", "El valor del secret no aparece en salida JSON"

### T6 — Check `tcp-connectivity`

- **Depends on**: T1
- **Files**: `src/doctor.ts`
- **Estimated diff**: ~35 líneas
- **Acceptance**:
  - [x] Usa `net.createConnection({ host: ctx.config.host, port: ctx.config.port })`
  - [x] `socket.setTimeout(3000)` y cleanup en `error`, `timeout`, `close`
  - [x] `connect` antes de 3s → `ok` con `data: { durationMs }` (medido con `performance.now()` o `Date.now()`)
  - [x] `error.code === "ETIMEDOUT"` → `warn` con `detail: "tcp probe timeout after 3000ms"`
  - [x] `error.code === "ECONNREFUSED" | "ENOTFOUND" | "EHOSTUNREACH"` → `fail` con `detail` saneado (sin IPv6 link-local completo, sin path)
  - [x] El probe NO escribe al socket (verificable por spy de `socket.write` en test)
  - [x] `socket.destroy()` se llama en `finally` para no leakear descriptores
- **Maps to spec scenarios**: "Probe TCP exitoso contra host alcanzable", "Probe TCP reporta FAIL por conexión rechazada", "Probe TCP reporta WARN por timeout", "El probe TCP no envía credenciales"

### T7 — Check `whitelist`

- **Depends on**: T1
- **Files**: `src/doctor.ts`
- **Estimated diff**: ~18 líneas
- **Acceptance**:
  - [x] Cuenta `whitelist.length` (schemas) y suma de `tables.length` (total tables)
  - [x] `detail` en text mode: `"N schemas, M tables"` (sin nombres)
  - [x] `data.whitelist` en JSON mode: array completo con `schema` + `tables[]`
  - [x] Nunca retorna `fail` (data-bearing): `ok` si whitelist no vacía, `warn` si vacía
  - [x] No loguea nombres en text mode (cumple decisión de producto)
- **Maps to spec scenarios**: "Doctor sale con código 0 cuando todos los checks pasan" (happy path)

### T8 — Check `keychain`

- **Depends on**: T1
- **Files**: `src/doctor.ts`
- **Estimated diff**: ~30 líneas
- **Acceptance**:
  - [ ] Invoca `loadSecret(KEYTAR_ACCOUNT, env, ctx.secretStore)` desde `src/keytar.ts`
  - [ ] `secretStore !== null && secret presente` → `ok` con `detail: "secret present"`
  - [ ] `secretStore !== null && secret null/""` → `fail` con `detail: "missing secret: run yhat-mcp setup"`
  - [ ] `secretStore === null && platform in ["linux","darwin"]` → `fail` con hint `install libsecret-1-0`
  - [ ] `secretStore === null && platform === "win32"` → `warn` con `detail: "keytar prebuild not available; password will fall back to env"`
  - [ ] `data` nunca contiene el valor del secret
- **Maps to spec scenarios**: "Doctor sale con código 1 cuando al menos un check está en WARN", "Doctor sale con código 2 cuando al menos un check está en FAIL", "Keytar cargable y secret presente", "Keytar cargable y secret ausente", "Keytar no cargable en plataforma que lo requiere", "Keytar no cargable en plataforma con keychain no estándar", "Doctor prioriza FAIL sobre WARN en el exit code"

### T9 — Check `audit-log`

- **Depends on**: T1
- **Files**: `src/doctor.ts`
- **Estimated diff**: ~25 líneas
- **Acceptance**:
  - [ ] Usa `resolveAuditLogDir(config.audit.logDir, ctx.root)` desde `src/paths.ts`
  - [ ] `stat` del directorio + `access(W_OK)`
  - [ ] Directorio no existe o no escribible → `fail`
  - [ ] Glob `audit-*.ndjson` para detectar el archivo activo, match del regex `audit-YYYY-MM-DDTHH-MM-SS-SSSZ.ndjson`; si no hay activo, `sizeBytes = 0`
  - [ ] `sizeBytes < maxSizeMb * 0.9 * 1_048_576` → `ok` con `detail: "current file <size>"`
  - [ ] Entre 90% y 100% → `warn` con `detail: "current file near limit (<size> / <max> MB)"`
  - [ ] `maxSizeMb` se lee de `config.audit.maxSizeMb` (no hardcoded)
- **Maps to spec scenarios**: "Doctor sale con código 0 cuando todos los checks pasan" (happy path), "Doctor sale con código 1 cuando al menos un check está en WARN" (caso near-limit)

### T10 — Check `opencode-registration`

- **Depends on**: T1
- **Files**: `src/doctor.ts`
- **Estimated diff**: ~14 líneas
- **Acceptance**:
  - [ ] Duplica la función de 8 líneas de `readOpenCodeConfig` de `src/cli.ts` (no la exporta)
  - [ ] Verifica `mcp?.["yhat-sql"] !== undefined`
  - [ ] Config existe y contiene `yhat-sql` → `ok` con `detail: "yhat-sql registered"`
  - [ ] Config existe sin la entrada → `warn` con `detail: "yhat-sql not in mcp config"`
  - [ ] Config no existe → `fail` con `detail: "opencode config not found"`
- **Maps to spec scenarios**: "Doctor sale con código 0 cuando todos los checks pasan" (happy path), "Doctor preserva el comportamiento de los subcomandos existentes"

### T11 — Check `auth-roundtrip` (opt-in)

- **Depends on**: T1
- **Files**: `src/doctor.ts`
- **Estimated diff**: ~40 líneas
- **Acceptance**:
  - [ ] Se exporta como check pero el orquestador lo omite si `flags.checkAuth === false`
  - [ ] `config.limits.queryTimeoutSeconds` indefinido → `fail` con `detail: "config missing queryTimeoutSeconds; cannot run auth check"`
  - [ ] Carga secret con `loadSecret`; si retorna null → `fail` con `detail: "credentials not stored"`
  - [ ] Crea `sql.ConnectionPool` con los mismos parámetros que `testConnection` (reusar patrón, no duplicar setup)
  - [ ] Ejecuta `SELECT 1` dentro de `try/catch/finally`
  - [ ] `pool.close()` en `finally`
  - [ ] `catch`: regex redacta `password|user|secret|connection string` con `[REDACTED]` antes de componer el `detail`
  - [ ] Éxito → `ok` con `data: { durationMs }`
  - [ ] `data` y `detail` nunca contienen el valor del secret
- **Maps to spec scenarios**: "Auth check presente y exitoso", "Sin flag, el check de auth no se ejecuta", "Auth check presente y secret ausente", "Auth check presente y credencial incorrecta", "`--check auth` no modifica el audit log"

### T12 — Orquestación `runDoctor({ flags, deps })`

- **Depends on**: T1–T11
- **Files**: `src/doctor.ts`
- **Estimated diff**: ~55 líneas
- **Acceptance**:
  - [x] Firma: `runDoctor({ flags, deps }): Promise<DoctorReport>` (inyección de deps para tests; default factories reusan `getConfigRoot`, `getEnvPath`, `loadConfigFile`, `loadSecretStore`, `resolveAuditLogDir`)
  - [ ] Paso 1: `prepareRuntimeEnvironment()`
  - [ ] Paso 2: resuelve `root`, `envPath`, `configPath`
  - [ ] Paso 3 (crash fast): `loadConfigFile` throws → escribe a `stderr` el path y `"Run 'yhat-mcp setup' first."`, setea `process.exitCode = 2`, retorna `DoctorReport` con `checks: []`, `summary: { ok: 0, warn: 0, fail: 0 }`, `exitCode: 2`, SIN imprimir nada en stdout
  - [x] Paso 4: cachea `secretStore` en el ctx
  - [x] Paso 5: ejecuta checks en orden, cada uno envuelto en try/catch → `fail` con `detail: "internal error: <message>"`
  - [x] Paso 6: agrega `summary` y computa `exitCode` con `reduce` (`FAIL > WARN > OK`)
  - [x] Paso 7: retorna el `DoctorReport` (NO escribe a stdout — eso lo hace el caller)
  - [x] Paso 8: nunca llama `process.exit(N)`
- **Maps to spec scenarios**: "Config ausente produce exit 2 sin más diagnóstico", "Doctor ejecuta la suite de checks de solo lectura" (cubre los 4 scenarios de exit code)

> **Note PR1**: pasos 1–3 (prepareRuntimeEnvironment + crash-fast) viven en
> `src/cli.ts` (PR2). El orquestador de PR1 expone `runDoctorCore({ flags, deps })`
> con deps inyectadas; el caller de PR2 cierra el ciclo y conecta
> `loadConfigFile` + `prepareRuntimeEnvironment` + crash-fast.

### T13 — Detección TTY + dispatch de render

- **Depends on**: T1, T2, T12
- **Files**: `src/doctor.ts`
- **Estimated diff**: ~12 líneas
- **Acceptance**:
  - [x] Exporta `detectOutputMode(): "text" | "json"` que retorna `"text"` solo si `process.stdout.isTTY === true`
  - [x] Exporta `renderReport(report): string` que delega a `formatReport(report, detectOutputMode())`
  - [x] Sin side effects: la función NO escribe a stdout (responsabilidad del caller en el CLI)
- **Maps to spec scenarios**: "Salida en modo texto cuando stdout es una TTY", "Salida en modo JSON cuando stdout no es una TTY"

### T14 — Tests de los checks 1–5,7 y de los helpers de render

- **Depends on**: T1, T2, T3, T4, T5, T6, T7, T12, T13
- **Files**: `tests/doctor.test.ts` (create, partial)
- **Estimated diff**: ~190 líneas
- **Acceptance**:
  - [x] Test 1: happy path (todos los checks mockeados como OK) → `exitCode === 0`
  - [x] Test 2: keychain mock retorna WARN (Windows fresh-install) → `exitCode === 1`
  - [x] Test 3: keychain mock retorna FAIL (cargable + sin secret) → `exitCode === 2`
  - [x] Test 4: FAIL + WARN coexistentes → `exitCode === 2` (prioridad)
  - [x] Test 5: `formatReport(report, "text")` retorna tabla con `CHECK | STATUS | DETAIL` y footer con summary
  - [x] Test 6: `toJsonReport(report)` retorna string parseable por `JSON.parse`
  - [x] Test 7: `toJsonReport` en `os.EOL === "\r\n"` no contiene `\r`
  - [x] Test 8: secret `"supersecret123"` no aparece en `formatReport(report, "text")` ni en `toJsonReport(report)`
  - [x] Test 10: TCP probe OK (mock `net.createConnection` con spy) → `status: "ok"`, `data.durationMs > 0`
  - [x] Test 11: mock TCP server con puerto cerrado → `status: "fail"`
  - [ ] Test 12: mock TCP server que cuelga → `status: "warn"` después de 3s (con timer fake o `setTimeout` mock) — _documented scope decision: skip para no inflar CI; covered por ECONNREFUSED/ENOTFOUND settling paths_
  - [x] Test 13: spy de `socket.write` confirma que el probe no envía credenciales
  - [x] Test 22: dos invocaciones idénticas (mismo ctx, mismo deps) → `JSON.stringify` con timestamps/durations enmascarados produce `deepEqual`
- **Maps to spec scenarios**: "Doctor sale con código 0…", "Doctor sale con código 1…", "Doctor sale con código 2…", "Doctor prioriza FAIL sobre WARN…", "Salida en modo texto…", "Salida en modo JSON…", "Salida JSON usa finales de línea LF", "El valor del secret no aparece en salida de texto", "El valor del secret no aparece en salida JSON", "Probe TCP exitoso…", "Probe TCP reporta FAIL…", "Probe TCP reporta WARN…", "El probe TCP no envía credenciales", "Dos invocaciones producen la misma estructura"

### T15 — CLI wiring (`case "doctor":` + ayuda)

- **Depends on**: T1, T12, T13 (los checks restantes ya viven en el módulo, pero `case "doctor":` solo necesita `runDoctor` y `renderReport`)
- **Files**: `src/cli.ts`
- **Estimated diff**: ~12 líneas
- **Acceptance**:
  - [ ] Inserta `case "doctor":` entre `case "config":` y `default:` (mantiene orden alfabético)
  - [ ] Parsea `--check-auth` o `--check auth` para setear `checkAuth`
  - [ ] Llama `await runDoctor({ flags: { checkAuth }, deps: defaultDeps })`
  - [ ] Escribe `renderReport(report) + "\n"` a stdout con `process.stdout.write` (no `console.log`)
  - [ ] Setea `process.exitCode = report.exitCode`
  - [ ] Extiende el bloque de ayuda del `default:` con la línea `doctor    Run read-only diagnostic checks (use --check auth to verify credentials)`
- **Maps to spec scenarios**: "La ayuda del CLI lista `doctor`", "Doctor preserva el comportamiento de los subcomandos existentes"

### T16 — Fila de README en la tabla CLI

- **Depends on**: T15
- **Files**: `README.md`
- **Estimated diff**: ~2 líneas
- **Acceptance**:
  - [ ] Agrega una fila en la tabla CLI (líneas 79-86) con el comando `doctor` y una descripción de una línea que mencione `--check auth`
  - [ ] No cambia el formato del resto de la tabla
- **Maps to spec scenarios**: "La ayuda del CLI lista `doctor`" (cobertura secundaria, ayuda CLI ya cubierta por T15)

### T17 — Tests de los checks 6, 8, 9, 10 y de los escenarios de integración

- **Depends on**: T8, T9, T10, T11, T15
- **Files**: `tests/doctor.test.ts` (extend)
- **Estimated diff**: ~140 líneas
- **Acceptance**:
  - [ ] Test 9: `loadConfigFile` mock throws ENOENT → `runDoctor` setea `exitCode: 2`, `process.exitCode === 2`, stderr contiene la ruta y `"yhat-mcp setup"`
  - [ ] Test 14: `--check auth` con secret válido + DB mock (mssql mockeado a nivel de `sql.ConnectionPool`) → `status: "ok"`, `data.durationMs > 0`
  - [ ] Test 15: `runDoctor({ flags: { checkAuth: false } })` → `report.checks` NO contiene `id === "auth-roundtrip"`
  - [ ] Test 16: `--check auth` con secret ausente → `status: "fail"`, `detail.includes("credentials not stored")`
  - [ ] Test 17: `--check auth` con secret incorrecto → `status: "fail"`, `detail` NO contiene `"supersecret123"`
  - [ ] Test 18: keytar cargable + secret presente → `keychain` `status: "ok"`
  - [ ] Test 19: keytar cargable + secret ausente → `keychain` `status: "fail"`, `detail.includes("missing secret")`
  - [ ] Test 20: `Object.defineProperty(process, "platform", { value: "linux" })` + `secretStore === null` → `keychain` `status: "fail"`, `detail` incluye hint de libsecret
  - [ ] Test 21: `Object.defineProperty(process, "platform", { value: "win32" })` + `secretStore === null` → `keychain` `status: "warn"`
  - [ ] Test 23: TCP sin cache — primera invocación con servidor vivo → `ok`, segunda con servidor cerrado → `fail` (sin estado global cacheado)
  - [ ] Test 24: `--check auth` no modifica el audit log (mtime/size inalterados entre antes/después)
  - [ ] Test 25: `npm test` ejecuta suite existente sin regresiones (`tests/keytar.test.ts`, `tests/audit.test.ts`, `tests/paths.test.ts` siguen verdes)
  - [ ] Test 26: `yhat-mcp` sin args invoca el dispatcher y la ayuda incluye la línea `doctor`
- **Maps to spec scenarios**: "Config ausente produce exit 2 sin más diagnóstico", "Auth check presente y exitoso", "Sin flag, el check de auth no se ejecuta", "Auth check presente y secret ausente", "Auth check presente y credencial incorrecta", "Keytar cargable y secret presente", "Keytar cargable y secret ausente", "Keytar no cargable en plataforma que lo requiere", "Keytar no cargable en plataforma con keychain no estándar", "El probe TCP no se cachea entre invocaciones", "`--check auth` no modifica el audit log", "Los tests de los subcomandos existentes siguen pasando", "La ayuda del CLI lista `doctor`"

---

## Coverage matrix (spec → tasks)

| Spec Requirement | Spec Scenario (count) | Tasks |
|---|---|---|
| Doctor ejecuta la suite de checks de solo lectura | 4 scenarios | T12, T14, T17 |
| Doctor adapta el formato de salida al destino | 3 scenarios | T2, T13, T14 |
| Doctor nunca imprime el valor de los secretos | 2 scenarios | T5, T8, T11, T14 |
| Doctor aborta rápido cuando la configuración no existe | 1 scenario | T12, T17 |
| Doctor realiza un probe TCP por defecto | 4 scenarios | T6, T14 |
| El check de credenciales es opt-in (`--check auth`) | 4 scenarios | T11, T14, T17 |
| Doctor clasifica el estado de keytar de forma distinta | 4 scenarios | T8, T14, T17 |
| Doctor es idempotente entre invocaciones | 3 scenarios | T6, T11, T14, T17 |
| Doctor preserva el comportamiento de los subcomandos existentes | 2 scenarios | T15, T16, T17 |

Total scenarios: **27**. Todos mapeados a al menos una task; todos los checks
del design (1, 2, 3, 5, 6, 7, 8, 9, 10 — `config-file` es precondición)
tienen al menos una task dedicada.

---

## Review Workload Forecast

- **Estimated total diff**: 627 líneas (code 360 + tests 265 + docs 2).
- **PR1 diff**: 341 líneas (código + tests parciales, sin tocar `src/cli.ts` ni `README.md`).
- **PR2 diff**: 286 líneas (código restante + tests + CLI wiring + README).
- **400-line budget risk**: Medium (PR1 en 341; PR2 en 286).
- **Chained PRs recommended**: Yes (cerrado en design; revisor ≤60 min por PR).
- **Estimated review time per PR**: <60 min por PR (PR1 foco orquestación + render; PR2 foco clasificación keychain + integración CLI).
- **Decision needed before apply**: Yes — el orchestrator debe preguntar al usuario entre `stacked-to-main` y `feature-branch-chain` antes de lanzar `sdd-apply` (la decisión de chain strategy NO está en tasks; vive en apply).
- **Tests in scope**: 26 escenarios cubiertos (1 escenario del spec — "El valor del secret no aparece en salida JSON" — se cubre con el mismo test 8 que cubre el escenario de text mode, según el design).
- **Spec coverage check**: cada `### Requirement` del spec tiene ≥1 task; cada `#### Scenario` está mapeado arriba.

### Plain-text guard lines (literal, contrato para apply)

```
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Medium
```

### Suggested chain strategy options for the orchestrator to surface

| Strategy | Why it fits this change |
|---|---|
| `stacked-to-main` | Cada PR deja el repo en estado limpio (PR1 expone `runDoctor` testeado pero no cableado al CLI; PR2 cablea). Los dos slices pueden vivir en main secuencialmente sin feature branch acumulador. |
| `feature-branch-chain` | Si el equipo quiere que `yhat-mcp doctor` NO sea invocable hasta que toda la chain esté integrada. Más fricción pero rollback más limpio. |
| `size:exception` | NO recomendado: el split propuesto es natural y respeta dependencias técnicas, no requiere exception. |