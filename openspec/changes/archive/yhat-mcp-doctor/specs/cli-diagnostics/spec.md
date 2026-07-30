# Cambiar Spec: cli-diagnostics

## Propósito adicional

Esta capability cubre los subcomandos del CLI `yhat-mcp` cuyo propósito es
inspeccionar el estado de la instalación sin modificarla. El cambio introduce
el subcomando `doctor`, que ejecuta una suite de nueve checks de solo lectura
sobre los componentes críticos del runtime (config, keytar, secret, audit
log, registro en OpenCode, conectividad TCP y, opcionalmente, credenciales
contra el SQL Server) y reporta el estado de cada uno junto con un exit code
procesable. La salida se adapta al destino (texto en TTY, JSON en pipe o
redirección) y nunca expone el valor de secretos almacenados.

Los subcomandos existentes (`setup`, `start`, `install`, etc.) no se ven
afectados y conservan su comportamiento.

## Requisitos adicionales

### Requirement: Doctor ejecuta la suite de checks de solo lectura

El sistema SHALL proveer el subcomando `yhat-mcp doctor` que ejecuta la
suite completa de checks de solo lectura y devuelve un exit code agregado en
función del peor estado observado, con la siguiente jerarquía:
`FAIL > WARN > OK`.

#### Scenario: Doctor sale con código 0 cuando todos los checks pasan

- **Dado** una instalación completamente configurada (config presente,
  keytar cargable, secret almacenado, directorio de audit escribible,
  OpenCode registrado y probe TCP exitoso)
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** el proceso sale con código de salida `0`
- **Y** el reporte lista cada check ejecutado con estado `OK`

#### Scenario: Doctor sale con código 1 cuando al menos un check está en WARN

- **Dado** una instalación donde el único check en estado no-`OK` es un
  check clasificado como `WARN` (por ejemplo, `keytar` no cargable en una
  plataforma donde el keychain no es estándar)
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** el proceso sale con código de salida `1`
- **Y** el reporte lista ese check con estado `WARN` y los checks
  restantes con `OK`

#### Scenario: Doctor sale con código 2 cuando al menos un check está en FAIL

- **Dado** una instalación donde el único check en estado no-`OK` es un
  check clasificado como `FAIL` (por ejemplo, `keytar` cargable pero sin
  secret almacenado, o `keytar` no cargable en una plataforma que lo
  requiere)
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** el proceso sale con código de salida `2`
- **Y** el reporte lista ese check con estado `FAIL` y los checks
  restantes con `OK`

#### Scenario: Doctor prioriza FAIL sobre WARN en el exit code

- **Dado** una instalación con al menos un check en `WARN` y al menos un
  check en `FAIL`
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** el proceso sale con código de salida `2`
- **Y** el reporte lista ambos checks con sus estados respectivos

### Requirement: Doctor adapta el formato de salida al destino

El sistema SHALL detectar si la salida estándar es una terminal interactiva
(`process.stdout.isTTY === true`) y, en función de eso, formatear el
reporte como tabla de texto o como objeto JSON. La estructura de datos
subyacente SHALL ser la misma en ambos formatos; solo cambia la
representación.

#### Scenario: Salida en modo texto cuando stdout es una TTY

- **Dado** un proceso donde `process.stdout.isTTY === true`
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** la salida es una tabla de texto con columnas para nombre
  del check, estado (`OK`/`WARN`/`FAIL`) y detalle breve
- **Y** la tabla es legible en una terminal de 80 columnas sin truncado

#### Scenario: Salida en modo JSON cuando stdout no es una TTY

- **Dado** un proceso donde `process.stdout.isTTY` es `false` o `undefined`
  (pipe, redirección o ejecución en CI)
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** la salida es un único objeto JSON serializado en una sola
  línea
- **Y** el objeto es parseable por `JSON.parse(stdout)` sin preprocesamiento

#### Scenario: Salida JSON usa finales de línea LF

- **Dado** cualquier invocación de `yhat-mcp doctor` que produzca salida
  JSON en una máquina Windows
- **Cuando** se captura la salida binaria y se inspeccionan los bytes
- **Entonces** la salida contiene únicamente bytes `0x0A` como separadores
  de línea, sin bytes `0x0D` (CR) espurios

### Requirement: Doctor nunca imprime el valor de los secretos

El sistema SHALL redactar o excluir cualquier valor de secreto almacenado
(keytar, variables de entorno interpoladas en la config) tanto en la salida
estándar como en la salida de error, en ambos formatos (texto y JSON).

#### Scenario: El valor del secret no aparece en salida de texto

- **Dado** un secret almacenado en keytar con valor arbitrario
- **Cuando** el usuario ejecuta `yhat-mcp doctor` en modo TTY
- **Entonces** ni la salida estándar ni la salida de error contienen el
  valor del secret, completo ni parcialmente

#### Scenario: El valor del secret no aparece en salida JSON

- **Dado** un secret almacenado en keytar con valor arbitrario
- **Cuando** el usuario ejecuta `yhat-mcp doctor` con stdout redirigido a
  un archivo
- **Entonces** el JSON resultante no contiene el valor del secret, ni
  siquiera codificado o truncado

### Requirement: Doctor aborta rápido cuando la configuración no existe

El sistema SHALL terminar inmediatamente con código de salida `2` y un
mensaje accionable cuando el archivo de configuración no se encuentra en
la ruta resuelta por `getConfigRoot` / `getEnvPath`, sin ejecutar el resto
de los checks.

#### Scenario: Config ausente produce exit 2 sin más diagnóstico

- **Dado** un proceso donde `loadConfigFile()` no encuentra el archivo
  de configuración
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** el proceso sale con código de salida `2` antes de evaluar
  cualquier otro check
- **Y** la salida de error nombra la ruta resuelta donde se esperaba el
  archivo
- **Y** la salida incluye el texto `yhat-mcp setup` como remediación
  sugerida

### Requirement: Doctor realiza un probe TCP por defecto

El sistema SHALL incluir en la suite estándar un check de conectividad
TCP contra el `host` y `port` declarados en la configuración, implementado
con `net.createConnection` y un timeout de `3000` milisegundos, sin
enviar credenciales ni negociar TLS.

#### Scenario: Probe TCP exitoso contra host alcanzable

- **Dado** una configuración con `host` y `port` cuyo endpoint acepta
  conexiones TCP
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** el reporte incluye un check de conectividad con estado
  `OK` y duración medida en milisegundos

#### Scenario: Probe TCP reporta FAIL por conexión rechazada

- **Dado** una configuración cuyo `host:port` rechaza conexiones
  (`ECONNREFUSED`)
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** el reporte incluye ese check con estado `FAIL` y un
  mensaje saneado que nombra el error

#### Scenario: Probe TCP reporta WARN por timeout

- **Dado** una configuración cuyo `host:port` no responde antes de los
  `3000` milisegundos
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** el reporte incluye ese check con estado `WARN` y un
  mensaje que identifica el timeout

#### Scenario: El probe TCP no envía credenciales

- **Dado** cualquier configuración con secret almacenado en keytar
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** el tráfico del probe hacia el host NO contiene el valor
  del secret ni el nombre de usuario

### Requirement: El check de credenciales es opt-in

El sistema SHALL exponer un flag `--check auth` que, cuando está presente,
agrega a la suite un check adicional que ejecuta `SELECT 1` usando el
secret cargado desde keytar y respeta `queryTimeoutSeconds` de la
configuración. Sin el flag, el subcomando SHALL NO intentar autenticarse
contra el SQL Server.

#### Scenario: Auth check presente y exitoso

- **Dado** un secret almacenado en keytar con credenciales válidas para
  el `host:port` configurado y un `queryTimeoutSeconds` definido
- **Cuando** el usuario ejecuta `yhat-mcp doctor --check auth`
- **Entonces** el reporte incluye un check de autenticación con estado
  `OK` y la duración del round-trip en milisegundos

#### Scenario: Sin flag, el check de auth no se ejecuta

- **Dado** un secret almacenado en keytar con credenciales válidas
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** el reporte NO contiene ningún check de autenticación, ni
  siquiera con estado `OK`

#### Scenario: Auth check presente y secret ausente

- **Dado** keytar cargable pero sin secret almacenado
- **Cuando** el usuario ejecuta `yhat-mcp doctor --check auth`
- **Entonces** el reporte incluye el check de autenticación con estado
  `FAIL`
- **Y** el mensaje contiene el texto `credentials not stored`

#### Scenario: Auth check presente y credencial incorrecta

- **Dado** un secret almacenado que NO autentica contra el SQL Server
- **Cuando** el usuario ejecuta `yhat-mcp doctor --check auth`
- **Entonces** el reporte incluye el check de autenticación con estado
  `FAIL`
- **Y** el mensaje de error no incluye el valor del secret

### Requirement: Doctor clasifica el estado de keytar de forma distinta

El sistema SHALL distinguir, para el check de keytar, entre "keytar no
cargable en una plataforma que lo requiere" (FAIL), "keytar no cargable
en una plataforma donde el keychain no es estándar" (WARN) y "keytar
cargable con secret ausente" (FAIL), siguiendo el mapeo ya validado en
`src/keytar.ts`.

#### Scenario: Keytar cargable y secret presente

- **Dado** keytar cargable y un secret almacenado para la cuenta
  configurada
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** el reporte incluye un check de keytar con estado `OK`

#### Scenario: Keytar cargable y secret ausente

- **Dado** keytar cargable pero ningún secret almacenado para la cuenta
  configurada
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** el reporte incluye un check de keytar con estado `FAIL`
  con un mensaje que indique que falta el secret

#### Scenario: Keytar no cargable en plataforma que lo requiere

- **Dado** una plataforma que requiere keytar (por ejemplo, Linux sin
  `libsecret`) y keytar no cargable
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** el reporte incluye un check de keytar con estado `FAIL`
  con un hint accionable sobre cómo instalar la dependencia

#### Scenario: Keytar no cargable en plataforma con keychain no estándar

- **Dado** una plataforma donde el keychain no es estándar (por ejemplo,
  Windows en una instalación fresca donde el usuario no ha iniciado
  sesión con Microsoft Account) y keytar no cargable
- **Cuando** el usuario ejecuta `yhat-mcp doctor`
- **Entonces** el reporte incluye un check de keytar con estado `WARN`
  con un mensaje informativo, no bloqueante

### Requirement: Doctor es idempotente entre invocaciones

El sistema SHALL producir, salvo por los campos temporales (timestamps,
duraciones), reportes estructuralmente idénticos al ejecutarse dos veces
consecutivas sobre la misma instalación.

#### Scenario: Dos invocaciones producen la misma estructura

- **Dado** una instalación estable (sin cambios entre invocaciones)
- **Cuando** el usuario ejecuta `yhat-mcp doctor` dos veces seguidas y
  compara los JSON resultantes ignorando timestamps y duraciones
- **Entonces** los dos JSON son estructuralmente idénticos

#### Scenario: El probe TCP no se cachea entre invocaciones

- **Dado** un endpoint que responde a un probe TCP en la primera
  invocación y deja de responder antes de la segunda
- **Cuando** el usuario ejecuta `yhat-mcp doctor` dos veces seguidas
- **Entonces** la primera invocación reporta el probe con estado `OK`
- **Y** la segunda invocación reporta el probe con estado `FAIL` (sin
  heredar el resultado anterior)

#### Scenario: `--check auth` no modifica el audit log

- **Dado** un audit log preexistente con tamaño y contenido conocidos
- **Cuando** el usuario ejecuta `yhat-mcp doctor --check auth` sobre una
  instalación con credenciales válidas
- **Entonces** el audit log al finalizar la ejecución tiene exactamente
  el mismo tamaño y contenido que antes (verificable por hash o
  timestamp del último evento)

### Requirement: Doctor preserva el comportamiento de los subcomandos existentes

El sistema SHALL seguir exponiendo, sin cambios funcionales, los
subcomandos ya soportados por el CLI (`setup`, `start`, `install` y
cualquier otro presente al momento del cambio). Sus tests existentes
SHALL seguir pasando sin modificación.

#### Scenario: Los tests de los subcomandos existentes siguen pasando

- **Dado** la suite de tests previa al cambio `yhat-mcp-doctor`
- **Cuando** se ejecuta `npm test` con el cambio aplicado
- **Entonces** todos los tests previamente verdes siguen verdes
- **Y** ningún test previo es modificado o eliminado por este cambio

#### Scenario: La ayuda del CLI lista `doctor`

- **Dado** un usuario que ejecuta `yhat-mcp` sin subcomando (o `yhat-mcp
  --help`)
- **Cuando** el dispatcher cae en el bloque `default:`
- **Entonces** la ayuda incluye una línea describiendo `yhat-mcp doctor`
  y su flag opcional `--check auth`
