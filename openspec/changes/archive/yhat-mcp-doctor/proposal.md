# Cambiar: yhat-mcp-doctor

## Por qué

Hoy, un fallo en la instalación de `yhat-mcp-server` se manifiesta como un error confuso dentro del agente MCP, no como un mensaje accionable para el usuario. No existe una forma de "verificar que todo está sano" antes de delegar al servidor en producción. Esto genera tres problemas concretos: (1) un usuario en Linux sin `libsecret` o en una instalación fresca de Windows recibe un fallo que parece del SQL Server, cuando en realidad solo el `keytar` no carga; (2) un pipeline de CI no tiene cómo bloquear un deploy si la config está corrupta o el host es inalcanzable; (3) el equipo de soporte no puede pedir al usuario que ejecute "el comando de diagnóstico" porque no existe. Se necesita un comando `yhat-mcp doctor` read-only, ejecutable manualmente y en CI, que reporte el estado real de los 9 componentes críticos del runtime y devuelva un exit code procesable.

## Qué cambia

### Nuevo

- `yhat-mcp doctor` — corre la suite de 9 checks de solo lectura y sale con código 0/1/2.
- `yhat-mcp doctor --check auth` — agrega un check opcional de credenciales que hace `SELECT 1` con la password cargada desde keytar. Off por defecto.
- Formato de salida auto-detectado: TTY → tabla de texto; pipe/redirección/CI → JSON. Misma data shape en ambos modos.
- Módulo de orquestación `src/doctor.ts` que encapsula los 9 checks, el formateo de salida y el cómputo de exit code.
- Suite de tests `tests/doctor.test.ts` (estilo `tests/paths.test.ts` y `tests/audit.test.ts`) que cubre los nueve checks, los tres exit codes, el formateo de salida y la distinción "keytar no cargable" vs. "secret no almacenado".

### Modifica

- `src/cli.ts` — agregar `case "doctor":` en el dispatcher (líneas 795-836) y extender el bloque de ayuda del `default:`.
- `README.md` — agregar una fila a la tabla CLI (líneas 77-86) documentando `yhat-mcp doctor` y su flag `--check auth`.

Archivos a tocar (resumen):

- `src/doctor.ts` — nuevo, orquestación de checks y formateo de salida.
- `src/cli.ts` — agregar dispatcher, ~10 líneas, más ayuda.
- `README.md` — una fila en la tabla CLI.
- `tests/doctor.test.ts` — nuevo, cobertura de los 9 checks, exit codes, formateo.

## Casos fuera de alcance

1. Fix del UNION bypass en el validador de SQL o en el whitelist.
2. Rate limiting por sesión o por usuario.
3. Aplicar `queryTimeoutSeconds` al driver `mssql` (cambio de runtime, no de diagnóstico).
4. Limitar filas vía SQL `TOP`/`OFFSET` en lugar de post-fetch.
5. Forzar rotación del audit log.
6. Sink centralizado para el audit log.
7. Flag `--validate` contra `INFORMATION_SCHEMA` para validar el whitelist contra el SQL Server real.
8. `setup --dry-run` o `doctor --dry-run` separado.
9. Tuning del connection pool de `mssql`.
10. Agregar dependencias nuevas a `package.json`.
11. Update de `CHANGELOG.md` (solo se hace si pasa algo dramático; este cambio es iterativo).
12. Exportar `readOpenCodeConfig` desde `src/cli.ts` (queda privado, un único llamador nuevo no justifica refactor).

Si en el spec o design alguno de estos aparece como necesario, se debe escalar al orchestrator antes de continuar.

## Riesgos y mitigaciones

| # | Riesgo | Severidad | Mitigación |
|---|--------|-----------|------------|
| 1 | Filtración de credenciales en mensajes de error o en la salida del comando | Alta | Reusar `maskEnvVar` para redactar valores de `.env`; capturar y sanear todos los errores de `keytar` y `mssql`; nunca imprimir el valor del secret. Text mode solo reporta counts del whitelist. |
| 2 | TCP probe lento o cuelgue en redes mal configuradas | Media | `net.createConnection` con `setTimeout(() => socket.destroy(), 3000)`. `ECONNREFUSED` → FAIL, `ETIMEDOUT` → WARN. |
| 3 | `--check auth` cuelga o tarda demasiado si el SQL Server está vivo pero las credenciales están rate-limited | Media | Reusar `queryTimeoutSeconds` desde `loadConfigFile()` para el round-trip; si la config no tiene el campo, el check se niega a correr (FAIL con mensaje explícito) en vez de quedar indefinido. |
| 4 | Keychain no cargable en Linux sin `libsecret` o en fresh-install Windows genera FAIL cuando solo es WARN | Media | Distinguir explícitamente los dos estados: "keytar not loadable" (WARN, informativo) vs. "no secret stored" (FAIL, bloqueante). Mapeo ya validado en `src/keytar.ts:12`. |
| 5 | Path del audit log en install fresco: el directorio no existe todavía | Baja | `mkdir({ recursive: true })` se hace lazy al primer query; un doctor antes de cualquier query reporta "audit dir missing" como WARN, no FAIL. |
| 6 | Tamaño de PR supera el budget de 400 líneas | Baja | Diff estimado ~300-500 líneas (código + tests + docs). Si se acerca al límite, dividir en chained PRs siguiendo `work-unit-commits`: PR1 (helpers + checks 1-5), PR2 (checks 6-9 + CLI wiring + docs). |
| 7 | `process.exit` interrumpe flush de stderr o cleanup del dispatcher | Baja | Usar `process.exitCode = N` (patrón ya en `src/index.ts:24`), nunca `process.exit(N)`. |

## Decisiones de producto cerradas

1. **Formato de salida**: auto-detectado por `process.stdout.isTTY`. TTY → tabla de texto; pipe/redirect/CI → JSON. Misma estructura de datos.
2. **Config faltante**: crash fast, mensaje claro "config no encontrada en <path>, corré `yhat-mcp setup`", exit code 2. No diagnosticar parcialmente.
3. **Detalle del whitelist en el reporte**: text mode muestra solo counts (ej. `Whitelist: 2 schemas, 7 tables`). JSON mode incluye nombres completos de schemas y tablas. No se filtran nombres en text mode por riesgo de shoulder-surfing en oficinas y por ruido.
4. **Scope de `doctor`**: por defecto TCP probe (`net.createConnection` con timeout 3s). Flag `--check auth` opt-in que, además, corre `SELECT 1` con credenciales del keytar. Sin el flag, doctor NO intenta autenticarse.

Decisiones técnicas cerradas en explore (también baked-in):

- Usar `loadConfigFile` directo, sin wrapper.
- Reusar `maskEnvVar` para el reporte de `.env`.
- Usar `process.exitCode = N`, no `process.exit`.
- Distinguir "keytar not loadable" (WARN) de "no secret stored" (FAIL).
- "Current size" del audit = tamaño del archivo activo (matching `audit-YYYY-MM-DDTHH-MM-SS-SSSZ.ndjson` con glob), no suma del directorio.
- No tocar `CHANGELOG.md` salvo evento dramático.

## Plan de alto nivel

Reusar los helpers existentes sin introducir nuevo module surface innecesario: `getConfigRoot`, `getEnvPath`, `loadConfigFile`, `loadSecret`, `resolveAuditLogDir`, `readOpenCodeConfig`, `maskEnvVar`. La única superficie nueva es el orquestador `src/doctor.ts`, que expone `runDoctor({ checkAuth: boolean }): Promise<DoctorReport>` y una función de formateo pura `formatReport(report, mode: "text" | "json"): string` para testear sin tocar stdout. El dispatch en `src/cli.ts` consume el orquestador, llama a `prepareRuntimeEnvironment()` (necesario para que `loadConfigFile` interpole `YHAT_DB_*`), y setea `process.exitCode` según el peor estado agregado (OK=0, WARN=1, FAIL=2; tiebreak FAIL > WARN > OK). El TCP probe se implementa inline en `src/doctor.ts` con `net.createConnection` + timeout 3s; `--check auth` reusa el `mssql` connection ya presente en el árbol de dependencias sin agregar packages. Tests siguen el estilo de `tests/paths.test.ts` y `tests/audit.test.ts`: fixtures en `tests/fixtures/`, mocking del `SecretStore` inyectable y de `fs` cuando hace falta. Estimación de diff: ~300-500 líneas incluyendo tests y la fila de README. Si la cifra supera 400 al final de implement, dividir en dos PRs encadenados según `work-unit-commits`.

## Acceptance criteria (high level)

- [ ] `yhat-mcp doctor` sale con exit 0 cuando todos los checks aplicables pasan.
- [ ] `yhat-mcp doctor` sale con exit 1 cuando al menos un check está en WARN.
- [ ] `yhat-mcp doctor` sale con exit 2 cuando al menos un check está en FAIL, cuando la config no existe, o cuando `keytar` no es cargable en una plataforma que lo requiere.
- [ ] En text TTY mode, la tabla muestra nombre del check, estado (OK/WARN/FAIL) y detalle breve. Nunca se imprime el valor del secret.
- [ ] En JSON non-TTY mode, se imprime un objeto estructurado completo con todos los resultados, nombres donde el brief lo permite, sin truncar.
- [ ] `--check auth` corre un check adicional con credenciales almacenadas. Si las credenciales no están, FAIL con mensaje "credentials not stored". Si `SELECT 1` pasa, OK con duración; si falla, FAIL con error saneado.
- [ ] Sin el flag `--check auth`, doctor NO realiza autenticación contra el SQL Server.
- [ ] Ningún test existente se rompe.
- [ ] Output no filtra nombres de schema/tabla en text mode.
- [ ] El reporte text es legible en una terminal de 80 columnas.
- [ ] Output JSON es parseable por `JSON.parse` sin preprocessing.
