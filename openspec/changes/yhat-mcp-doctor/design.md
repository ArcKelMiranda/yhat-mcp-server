# Design: yhat-mcp-doctor

## Objetivos

Agregar el subcomando `yhat-mcp doctor`, de solo lectura, que ejecuta nueve
chequeos sobre los componentes críticos del runtime y devuelve un exit code
procesable. La implementación reutiliza los helpers existentes
(`getConfigRoot`, `getEnvPath`, `loadConfigFile`, `loadSecret`,
`resolveAuditLogDir`, `readOpenCodeConfig`, `maskEnvVar`) sin introducir
nuevas dependencias ni mover lógica existente. Este diseño evita
deliberadamente cualquier modificación al validador, al whitelist, al
connection pool o al audit logger.

## Module layout

### Added

- `src/doctor.ts` — orquestación de los nueve checks, agregación de estado,
  cálculo de exit code y funciones puras de formateo (`formatReport`).
- `tests/doctor.test.ts` — tests unitarios e integrados siguiendo el estilo
  de `tests/paths.test.ts` y `tests/audit.test.ts`.

### Modified

- `src/cli.ts` — agregar `case "doctor":` en el dispatcher (líneas 795-836)
  y extender el bloque de ayuda del `default:`.
- `README.md` — agregar una fila a la tabla CLI (líneas 79-86).

### Decisión: no extraer `readOpenCodeConfig`

Se documenta la alternativa pero se elige **duplicación mínima**: el helper
de `cli.ts` (8 líneas) se reimplementa dentro de `src/doctor.ts` con la
misma semántica. Razón: el orquestador solo necesita conocer la presencia
de la entrada MCP (`opencodeConfig.mcp?.["yhat-sql"] !== undefined`); no
necesita parsear ni mutar la config. Extraerlo a `src/opencode.ts` agregaría
export, ajuste de tipos y posibles cambios a `tests/opencode.test.ts` por
un único llamador nuevo. Si en el futuro aparecen dos llamadores más, se
extrae.

## Check type architecture

Las formas compartidas viven en `src/doctor.ts`:

```ts
export type CheckStatus = "ok" | "warn" | "fail";

export interface CheckResult {
  id: string;            // identificador estable, p.ej. "config-root"
  title: string;         // nombre humano, p.ej. "Config root directory"
  status: CheckStatus;
  detail?: string;       // resumen corto, sin secretos
  data?: unknown;        // payload JSON-serializable opcional
}

export interface CheckContext {
  root: string;
  envPath: string;
  config: Config;        // tipo de src/types.ts
  secretStore: SecretStore | null;
  flags: { checkAuth: boolean };
  pkgVersion: string;
}

export type Check = (ctx: CheckContext) => Promise<CheckResult> | CheckResult;

export interface DoctorReport {
  version: string;
  node: string;
  platform: NodeJS.Platform;
  arch: string;
  startedAt: string;     // ISO timestamp
  checks: readonly CheckResult[];
  summary: { ok: number; warn: number; fail: number };
  exitCode: 0 | 1 | 2;
}
```

> Nota: `Config` se infiere de `src/types.ts`; si el apply phase encuentra
> un mismatch entre la forma validada por `loadConfigFile` y esta
> declaración, ajustar para usar `Awaited<ReturnType<typeof loadConfigFile>>`
> como fuente de verdad.

### Los nueve checks

1. **`version`** — lee `package.json` (vía `await readFile("./package.json")`)
   para `version`, más `process.version` para Node, `process.platform` y
   `process.arch`. Siempre `ok`. `data: { node, platform, arch }`.

2. **`config-root`** — usa `getConfigRoot()` ya resuelto, `access(F_OK)` y
   `access(W_OK)`. `ok` si existe y es escribible; `warn` si solo existe
   pero no es escribible; `fail` si no existe.

3. **`env-file`** — verifica que `envPath` existe, parsea con `readEnvFile`
   (mismo helper de `cli.ts:67`), reporta keys `YHAT_DB_*` presentes/
   ausentes usando `maskEnvVar`. `ok` si todas las claves requeridas
   (`HOST`, `PORT`, `NAME`, `USER`, `PASSWORD_ENV`) están; `warn` si falta
   alguna no-secreto y se permite continuar; `fail` solo si el archivo no
   existe (el orquestador superior ya aborta si la config falta, pero un
   `.env` opcional puede faltar sin bloquear).

4. **`config-file`** — cubierto por el orquestador: `loadConfigFile()` ya
   se invoca arriba; si throws, doctor aborta con exit 2 (ver "Orchestration
   flow"). El check en sí mismo no se corre porque la config ya está
   validada para entonces. **Decisión**: omitir como check explícito;
   documentarlo en este design para que la spec de 9 checks se interprete
   como "9 chequeos de runtime" donde "config file parse" es precondición,
   no check.

5. **`tcp-connectivity`** — `net.createConnection({ host, port, timeout:
   undefined })` con `socket.setTimeout(3000)` y cleanup en todas las
   ramas. Estados:
   - `ok` → connect emite `connect` antes del timeout. `data: { durationMs }`.
   - `warn` → `ETIMEDOUT` (timeout 3s). Distinto de FAIL para que un
     firewall silencioso no bloquee CI.
   - `fail` → `ECONNREFUSED`, `ENOTFOUND`, `EHOSTUNREACH`. `detail` con el
     código de error saneado (sin el path, sin la IP completa si es IPv6
     link-local).

6. **`keychain`** — invoca `loadSecret(KEYTAR_ACCOUNT, env, secretStore)`.
   La distinción WARN/FAIL viene de la presencia o no de `secretStore`:
   - `secretStore !== null` y `getPassword(...)` retorna string no vacío →
     `ok`.
   - `secretStore !== null` y `getPassword(...)` retorna `null` o `""` →
     `fail` con `"missing secret: run yhat-mcp setup"`.
   - `secretStore === null` → depende del mapping del `proposal.md`:
     `fail` si la plataforma requiere keytar (Linux/Darwin); `warn` si
     Windows (keychain opcional). Ver "Cross-platform notes".

7. **`whitelist`** — data-bearing, nunca `fail`. Cuenta `whitelist.length`
   schemas y suma de `tables.length` para el total. En JSON mode incluye
   nombres completos (`schemas[].schema, tables[]`); en text mode solo
   counts. Detalle: `"2 schemas, 7 tables"`.

8. **`audit-log`** — `resolveAuditLogDir(config.audit.logDir, root)`,
   `stat` del directorio, `access(W_OK)`. Glob `audit-*.ndjson` y
   `state.activeLogFile` matching del regex (`audit-YYYY-MM-DDTHH-MM-SS-SSSZ.ndjson`)
   para "current size". Estados:
   - `ok` → directorio existe, escribible, current file < `maxSizeMb * 0.9`.
   - `warn` → current file entre 90% y 100% de `maxSizeMb`.
   - `fail` → directorio no existe o no escribible.

9. **`opencode-registration`** — duplica `readOpenCodeConfig` (ver
   "Decisión: no extraer"), verifica `mcp?.["yhat-sql"] !== undefined`.
   - `ok` → registrado.
   - `warn` → config existe pero no contiene la entrada.
   - `fail` → config no existe (OpenCode nunca corrió en este equipo).

10. **`auth-roundtrip`** — solo si `ctx.flags.checkAuth === true`. Crea
    `sql.ConnectionPool` con los mismos parámetros que `testConnection` de
    `cli.ts:204` (este sí reusa el patrón, no lo copia — son las mismas
    seis líneas de setup), ejecuta `SELECT 1`, mide duración, cierra.
    Estados:
    - `ok` → duración medida, `data: { durationMs }`.
    - `fail` "credentials not stored" si `loadSecret` retorna `null`.
    - `fail` "auth failed: <sanitized>" si `mssql` rechaza.
    - `fail` "config missing queryTimeoutSeconds" si el check se invoca
      sin `limits.queryTimeoutSeconds` definido (defensa explícita, ver
      riesgo #3 del proposal).

    **Importante**: el orquestador NUNCA llama a este check si
    `flags.checkAuth === false`, así que por defecto doctor NO toca el SQL
    Server.

## Orchestration flow

Pasos numerados del orquestador `runDoctor({ checkAuth })`:

1. **Pre-runtime**: invoca `prepareRuntimeEnvironment()` (igual que
   `cmdStart`) para que `loadEnv()` cargue `YHAT_DB_*` antes de cualquier
   interpolación.

2. **Path resolution**: `getConfigRoot()`, `getEnvPath()`,
   `getDefaultConfigPath()`. Calcula `root` y `configPath`.

3. **Crash fast**: intenta `loadConfigFile(configPath, env, root)`. Si
   throws, imprime a `stderr` `"Config file not found: <path>"` y
   `"Run 'yhat-mcp setup' first."`, setea `process.exitCode = 2`, retorna
   sin ejecutar más checks. **Crítico**: este es el único punto donde se
   sale sin ejecutar la suite, y se hace **antes** de imprimir nada en
   stdout, para que JSON mode no produzca un objeto parcial.

4. **SecretStore load**: invoca `loadSecretStore()` (helper privado de
   `keytar.ts`) una sola vez. Cachea el resultado en `ctx.secretStore`.

5. **Sequential execution**: ejecuta los checks en orden: `version`,
   `config-root`, `env-file`, `tcp-connectivity`, `keychain`,
   `whitelist`, `audit-log`, `opencode-registration`, y solo al final
   `auth-roundtrip` si `checkAuth`. Cada check está envuelto en un
   `try/catch` que captura cualquier throw y lo convierte en
   `{ status: "fail", detail: "internal error: <message>" }`.

6. **Aggregation**: `summary.ok/warn/fail` se cuentan sobre los resultados.
   `exitCode` se calcula con `reduce` (`FAIL > WARN > OK`).

7. **Render**: llama `formatReport(report, mode)` con `mode` derivado de
   `process.stdout.isTTY === true ? "text" : "json"`. Imprime el resultado
   a stdout con terminador `\n` explícito (no `console.log`, porque añade
   `\r\n` en Windows). En JSON mode, fuerza `JSON.stringify(report)` con
   line endings LF (`os.EOL === "\r\n"` se ignora).

8. **Exit**: setea `process.exitCode = report.exitCode` y retorna
   normalmente. Nunca `process.exit(N)`.

### Decisión: secuencial vs paralelo

**Recomendación: secuencial.** Razones:

- (a) el tiempo total está dominado por el TCP probe (timeout 3s); los
  demás checks son filesystem o CPU. Paralelizar ahorra <50ms.
- (b) `loadSecretStore()` carga `keytar` lazy; ejecutarlo una vez al
  principio y compartir el resultado evita racing el import dinámico en
  Windows (donde `require()` cachea por path pero `import()` puede ser
  flaky en workers).
- (c) tests más simples: ningún race a coordinar, ningún cleanup async
  después de los checks.

## Output rendering

### Text mode (TTY)

Tabla alineada con columnas `CHECK | STATUS | DETAIL`, ancho fijo 78
caracteres para ajustarse a terminales de 80 columnas sin truncado.

```
yhat-mcp doctor v0.1.0 (node v22.13.10 / win32 / x64)
2026-07-21T15:30:12.345Z

CHECK                  STATUS  DETAIL
version                OK      yhat-mcp-server 0.1.0
config-root            OK      C:\Users\Kelvin\AppData\Local\yhat-mcp
env-file               OK      YHAT_DB_HOST=set, YHAT_DB_USER=set, ...
tcp-connectivity       OK      12ms
keychain               OK      secret present
whitelist              OK      2 schemas, 7 tables
audit-log              OK      dir writable, current file 1.2 MB
opencode-registration  OK      yhat-sql registered

Summary: 8 OK, 0 WARN, 0 FAIL — exit 0
```

Iconos opcionales (`✓` / `!` / `✗`) en una columna adicional de 1 char
delante del status. Decisión: **sin iconos** en la primera iteración para
evitar problemas de encoding en Windows console hosts no-UTF8. Si la
segunda iteración quiere iconos, agregar flag `--color` separado.

### JSON mode (pipe/redirect/CI)

```json
{"version":"0.1.0","node":"v22.13.10","platform":"win32","arch":"x64","startedAt":"2026-07-21T15:30:12.345Z","checks":[{"id":"version","title":"Version","status":"ok","data":{"pkg":"yhat-mcp-server","node":"v22.13.10","platform":"win32","arch":"x64"}},{"id":"tcp-connectivity","title":"TCP connectivity","status":"ok","detail":"12ms","data":{"durationMs":12}}],"summary":{"ok":8,"warn":0,"fail":0},"exitCode":0}
```

Una sola línea, terminada en `\n` (LF incluso en Windows, ver
"Cross-platform notes"). Parsable por `JSON.parse(stdout)`. El `data`
del check `whitelist` en JSON mode incluye los nombres completos (cumple
la decisión de producto: "JSON mode incluye nombres completos").

Ambas representaciones se construyen desde el mismo `DoctorReport`; la
diferencia vive solo en `formatReport`.

## Error handling and secrets

- **keytar**: `loadSecret` y `loadSecretStore` ya tragan errores internamente.
  En el orquestador, cualquier throw de un check se captura y se reporta
  como `fail` con `detail: "internal error: <error.message>"` (sin stack).
- **mssql**: el check `auth-roundtrip` envuelve `pool.connect()`, `request`,
  `query("SELECT 1")` y `pool.close()` en `try/catch/finally`. En `catch`,
  sanitize: `error.message` se pasa por un regex que reemplaza
  cualquier match de `password|user|secret|connection string` con
  `[REDACTED]` (mismo patrón que `redactSensitiveText` en `audit.ts:66`).
  En `finally`, `pool.close()` se llama siempre.
- **.env**: `env-file` check usa `maskEnvVar` por línea; nunca expone
  el valor crudo.
- **exit**: `process.exitCode = N`, retorno normal. Patrón idéntico al
  `process.exitCode = 1` ya usado en `src/index.ts:24`. En Windows,
  `process.exit(N)` puede truncar stdout pipe buffers; `process.exitCode`
  deja que el event loop drene.

## Cross-platform notes

- **Windows**: `process.stdout.isTTY` funciona en `conhost` y
  Windows Terminal, pero algunas shells redirigidas con pipes reportan
  `false` correctamente. Asumir `isTTY === true` solo si `=== true`
  estrictamente, sino default a `json`. Esta es la regla que codifica
  el spec "Salida JSON cuando stdout no es una TTY".
- **Linux**: `libsecret` ausente → `loadSecretStore()` retorna `null`.
  El check `keychain` mapea esto a **`fail`** porque Linux sin
  libsecret no tiene alternativa: la spec dice "keytar no cargable en
  plataforma que lo requiere". `detail` recomienda
  `"install libsecret-1-0: sudo apt install libsecret-1-dev"`.
- **macOS**: en headless (sin login de usuario o ssh sin forwarding),
  `keychain` puede pedir unlock con un prompt GUI. El `getPassword`
  puede bloquear varios segundos. Doc en `detail` como
  `"keychain may be locked; this check can block"`. Status: `warn`
  si pasa de 2s, sino `fail` con timeout.
- **Windows fresh-install**: el Credential Manager no requiere secret
  service activo; `loadSecretStore` retorna `null` solo si la build
  prebuilt de `keytar` falla (raro). Mapeo: `warn` con
  `"keytar prebuild not available; password will fall back to env"`.

## CLI wiring

Edición concreta en `src/cli.ts` líneas 795-836:

```ts
const action = process.argv[2] ?? "help";

void (async (): Promise<void> => {
  prepareRuntimeEnvironment();

  switch (action) {
    case "setup":
      await cmdSetup();
      break;
    // ... existing cases ...

    case "doctor": {
      const checkAuth = process.argv.includes("--check-auth")
        || process.argv.includes("--check") && process.argv.includes("auth");
      const report = await runDoctor({ checkAuth });
      process.stdout.write(formatReport(report, detectOutputMode()) + "\n");
      process.exitCode = report.exitCode;
      break;
    }

    default:
      console.log(`Usage: yhat-mcp <command>

Commands:
  setup     Run the interactive setup wizard
  install   Install the MCP server in OpenCode config
  uninstall Remove the MCP server from OpenCode config
  start     Start the MCP server
  update    Check for and install updates
  config    Edit the whitelist interactively
  doctor    Run read-only diagnostic checks (use --check auth to verify credentials)
`);
  }
})();
```

`detectOutputMode()` retorna `"text"` si `process.stdout.isTTY === true`,
si no `"json"`.

Posición del case: después de `config` y antes del `default`, manteniendo
el orden alfabético que ya existe entre `setup`, `install`, `uninstall`,
`start`, `update`, `config`.

## Test plan

Cada scenario del spec se mapea a al menos un test en `tests/doctor.test.ts`.
Los tests usan `mkdtempSync` para aislar config dirs (mismo patrón que
`tests/paths.test.ts`) y mockean `SecretStore` (mismo patrón que
`tests/keytar.test.ts`).

| # | Test | Cubre spec scenario |
|---|------|---------------------|
| 1 | happy path → 8 OK → `exitCode === 0` | "Doctor sale con código 0 cuando todos los checks pasan" |
| 2 | keychain WARN → 1 WARN → `exitCode === 1` | "Doctor sale con código 1 cuando al menos un check está en WARN" |
| 3 | keychain FAIL (keytar cargable, secret ausente) → `exitCode === 2` | "Doctor sale con código 2 cuando al menos un check está en FAIL" |
| 4 | FAIL + WARN coexistentes → `exitCode === 2` | "Doctor prioriza FAIL sobre WARN en el exit code" |
| 5 | `process.stdout.isTTY = true` → `formatReport(report, "text")` contiene "OK" y tabla | "Salida en modo texto cuando stdout es una TTY" |
| 6 | `process.stdout.isTTY = undefined` → `formatReport(report, "json")` retorna `JSON.parse`-able | "Salida en modo JSON cuando stdout no es una TTY" |
| 7 | JSON mode en Windows → bytes `0x0D` ausentes | "Salida JSON usa finales de línea LF" |
| 8 | secret en keytar valor "supersecret123" → output (text y JSON) NO contiene "supersecret123" | "El valor del secret no aparece en salida de texto/json" |
| 9 | `loadConfigFile` throws ENOENT → exit 2, stderr contiene la ruta y "yhat-mcp setup" | "Config ausente produce exit 2 sin más diagnóstico" |
| 10 | mock TCP server en `127.0.0.1:0` → tcp-connectivity OK con `durationMs > 0` | "Probe TCP exitoso contra host alcanzable" |
| 11 | mock TCP server cierra el puerto → ECONNREFUSED → tcp-connectivity FAIL | "Probe TCP reporta FAIL por conexión rechazada" |
| 12 | mock TCP server con `setTimeout(() => {}, 5000)` → tcp-connectivity WARN a los 3s | "Probe TCP reporta WARN por timeout" |
| 13 | mock TCP server con `tcpdump`-equivalent (o spy en el socket) → paquete recibido NO contiene `YHAT_DB_PASSWORD` ni el user | "El probe TCP no envía credenciales" |
| 14 | `--check auth` con keytar mock + secret + DB mock → OK con `durationMs` | "Auth check presente y exitoso" |
| 15 | sin `--check auth` → checks NO contiene `auth-roundtrip` | "Sin flag, el check de auth no se ejecuta" |
| 16 | `--check auth` con secret ausente → FAIL con detalle "credentials not stored" | "Auth check presente y secret ausente" |
| 17 | `--check auth` con secret incorrecto → FAIL, mensaje NO contiene el secret | "Auth check presente y credencial incorrecta" |
| 18 | keytar cargable + secret presente → OK | "Keytar cargable y secret presente" |
| 19 | keytar cargable + secret ausente → FAIL con "missing secret" | "Keytar cargable y secret ausente" |
| 20 | keytar no cargable en `platform: "linux"` → FAIL con hint de libsecret | "Keytar no cargable en plataforma que lo requiere" |
| 21 | keytar no cargable en `platform: "win32"` → WARN informativo | "Keytar no cargable en plataforma con keychain no estándar" |
| 22 | dos invocaciones idénticas (sin timestamps/durations) → structural deep equal | "Dos invocaciones producen la misma estructura" |
| 23 | TCP probe sin cache: primera OK, segunda con servidor cerrado → segunda FAIL | "El probe TCP no se cachea entre invocaciones" |
| 24 | `--check auth` no escribe al audit log (mtime/size inalterados) | "`--check auth` no modifica el audit log" |
| 25 | `npm test` ejecuta suite existente sin regresiones | "Los tests de los subcomandos existentes siguen pasando" |
| 26 | `yhat-mcp` sin args imprime ayuda que incluye línea de `doctor` | "La ayuda del CLI lista `doctor`" |

Los tests 22-24 son integración pura (corren el binario via
`tsx src/cli.ts doctor`); el resto son unit sobre `runDoctor` o
`formatReport`.

## Diff forecast

| Bloque | Líneas estimadas |
|--------|------------------|
| `src/doctor.ts` | ~280 líneas (orchestrator + 9 checks + formatReport + types) |
| `src/cli.ts` | ~15 líneas (case + help update + detectOutputMode) |
| `tests/doctor.test.ts` | ~330 líneas (26 tests, ~12 líneas promedio) |
| `README.md` | ~2 líneas (una fila en la tabla) |
| **Total** | **~627 líneas** |

El total supera el budget de 400 líneas de `_shared/sdd-phase-common.md`.
**Recomendación: chained PRs** siguiendo `work-unit-commits`:

- **PR 1** — `src/doctor.ts` core + checks 1-5 (`version`, `config-root`,
  `env-file`, `tcp-connectivity`, `whitelist`) + formatReport + tests 1-13,
  18-22. Estimado ~340 líneas. Punto de revisión: orquestación + render.
- **PR 2** — checks 6-9 (`keychain`, `audit-log`, `opencode-registration`,
  `auth-roundtrip`) + CLI wiring + README + tests 14-17, 23-26. Estimado
  ~290 líneas. Punto de revisión: clasificación keychain + integración.

Si el orchestrator prefiere single-PR con `size:exception` explícito, se
puede entregar todo junto — el split es por carga cognitiva de review, no
por dependencia técnica (PR 2 branch point = PR 1 merged).

## Riesgos

1. **(medio) Variabilidad cross-platform de keytar**. Linux sin libsecret,
   macOS con keychain locked, Windows fresh-install reportan estados
   distintos. Mitigación: el spec ya distingue los tres casos; el check
   `keychain` mapea explícitamente. Tests 18-21 cubren el mapping.
2. **(bajo) Auto-detect TTY puede clasificar mal en Windows GUI terminals**.
   Mitigación: `=== true` estricto, default a JSON. Si un usuario
   legítimamente quiere text mode con pipe, puede capturar y formatear.
3. **(bajo) Refactor de `readOpenCodeConfig` tocaría `tests/opencode.test.ts`**.
   Decisión: duplicar en `doctor.ts`, no extraer. Documentado en
   "Decisión: no extraer".
4. **(bajo) Timeout del probe TCP en redes con alta latencia puede
   disparar WARN donde un setup legítimamente lento funcionaría**.
   Mitigación: 3s es el número del spec; documentar en help y aceptar.
5. **(medio) `auth-roundtrip` con `queryTimeoutSeconds` muy bajo aborta
   antes de completar el round-trip TCP+TLS**. Mitigación: el spec exige
   `queryTimeoutSeconds` definido para correr el check; sin él, FAIL
   explícito. Defensa explícita en apply.
6. **(bajo) Concurrencia con `yhat-mcp start` si el audit log está siendo
   escrito**. El check `audit-log` solo hace `stat`, no escribe; `auth-
   roundtrip` no loguea (verificado: usa `pool.connect()` directo, no
   `createAuditLogger`). Sin riesgo.

## Open questions for apply phase

- **Orden de los cases en el switch**: este diseño propone `doctor`
  después de `config`. Si el equipo prefiere alfabético estricto, ajustar.
- **Ancho de la tabla text mode**: propuesto 78 columnas. Si los títulos
  reales (`opencode-registration`, `config-root`) caben con margen en
  78, OK; si no, ajustar a 92 o usar `process.stdout.columns` con
  mínimo 80.
- **Tests 13 y 24 son costosos**: el spy TCP (test 13) puede hacerse con
  un interceptor de `net.createConnection`; el audit-log snapshot
  (test 24) requiere crear un archivo previo y verificar tamaño. Si el
  apply phase los ve frágiles, marcar como skip-en-CI y dejar
  documentados.
- **`--check auth` syntax**: el CLI dispatcher acepta `--check-auth`
  (estilo kebab) y `--check auth` (estilo GNU). El diseño soporta ambos
  por consistencia con otros CLIs de Node; si el equipo prefiere solo
  kebab, simplificar.