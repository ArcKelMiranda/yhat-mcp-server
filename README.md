# yhat-mcp-server

Servidor MCP (Model Context Protocol) que permite a asistentes de IA como OpenCode, Claude, Cursor y VS Code consultar Microsoft SQL Server de forma segura y controlada.

## Motivación

El equipo de datos de Yhat necesita que sus asistentes de IA puedan acceder a la base de datos SQL Server para responder preguntas, analizar datos y generar reportes — sin exponer credenciales, sin permitir escritura accidental, y sin que cada usuario tenga que configurar herramientas manualmente.

Este servidor resuelve eso con una arquitectura distribuida (cada usuario ejecuta su propia instancia local vía stdio), autenticación segura mediante keychain del SO, y un sistema de whitelist por esquema/tabla.

## Instalación

Requiere Node.js 20+.

La configuración estable vive fuera del working tree:

- Linux / macOS: `~/.local/share/yhat-mcp`
- Windows: `%LOCALAPPDATA%\yhat-mcp`

Podés sobrescribir esa raíz con `YHAT_CONFIG_ROOT`.

### Desde GitHub Releases (recomendado)

Los instaladores descargan el source archive de la última release, compilan el bundle en un directorio temporal y copian el resultado a la carpeta estable del usuario.

```bash
# Linux/macOS
curl -fsSL https://raw.githubusercontent.com/ArcKelMiranda/yhat-mcp-server/main/install.sh | bash

# Windows
irm https://raw.githubusercontent.com/ArcKelMiranda/yhat-mcp-server/main/install.ps1 | iex
```

Para fijar una versión específica:

```bash
YHAT_RELEASE_TAG=v0.2.0 bash install.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -ReleaseTag v0.2.0
```

> Nota: el paquete npm es interno/privado; la vía soportada para usuarios finales es GitHub Releases.

`yhat-mcp install` registra OpenCode con una entrada portátil y sin secretos:

```json
{"type":"local","command":["yhat-mcp","start"]}
```

## Primeros pasos

El CLI tiene un asistente interactivo que te guía por toda la configuración y escribe en la carpeta estable del usuario:

```bash
yhat-mcp setup
```

El wizard te va a pedir:

1. **Conexión a SQL Server** — host, puerto, base de datos, usuario, contraseña
2. **Whitelist** — qué esquemas y tablas querés habilitar para consultas
3. **Token de GitHub** — opcional, para recibir actualizaciones automáticas
4. **Instalación en OpenCode** — crea la entrada MCP automáticamente

La contraseña de la base de datos se almacena en el keychain del SO (Windows Credential Manager, macOS Keychain, libsecret en Linux). La `.env` estable no guarda `YHAT_DB_PASSWORD`.

## Comandos CLI

| Comando | Descripción |
|---------|-------------|
| `yhat-mcp setup` | Asistente interactivo de configuración inicial |
| `yhat-mcp start` | Inicia el servidor MCP (stdio) |
| `yhat-mcp install` | Registra el servidor en OpenCode |
| `yhat-mcp uninstall` | Remueve el servidor de OpenCode |
| `yhat-mcp config` | Editor interactivo del whitelist |
| `yhat-mcp update` | Busca y aplica actualizaciones desde GitHub Releases |

## Arquitectura

```
┌─────────────────────────────────────────┐
│       AI Assistant (OpenCode, etc.)      │
│              MCP Client                  │
└────────────────┬────────────────────────┘
                 │  stdio (JSON-RPC)
┌────────────────▼────────────────────────┐
│         yhat-mcp-server                  │
│                                          │
│  ┌─────────┐  ┌──────────┐  ┌────────┐  │
│  │  Query   │  │   SQL    │  │  Row   │  │
│  │  Guard   │──│ Parser   │──│ Limit  │  │
│  └─────────┘  └──────────┘  └────────┘  │
│       │              │            │       │
│  ┌────▼──────────────▼────────────▼────┐ │
│  │          Whitelist Auth             │ │
│  └────────────────┬───────────────────┘ │
│                   │                     │
│  ┌────────────────▼───────────────────┐ │
│  │       Database Layer (mssql)       │ │
│  └────────────────┬───────────────────┘ │
│                   │                     │
│  ┌────────────────▼───────────────────┐ │
│  │       Audit Logger (metadata)      │ │
│  └────────────────────────────────────┘ │
└────────────────┬────────────────────────┘
                 │
     SQL Server  │  (TDS protocol)
                 │
┌────────────────▼────────────────────────┐
│            SQL Server DB                 │
└─────────────────────────────────────────┘
```

### Flujo de una consulta

1. El AI Assistant envía una consulta SQL vía MCP
2. **Query Guard** analiza el AST: si no es un `SELECT`, la rechaza
3. **SQL Parser** verifica que las tablas referenciadas estén en el whitelist
4. **Row Limit** aplica un límite máximo de filas (configurable, default 1000)
5. Si todo pasa, se ejecuta contra SQL Server con parámetros sanitizados
6. **Audit Logger** registra metadata de la consulta (quién, qué tablas, cuántas filas, duración)

## Seguridad

### Credenciales

- **Contraseña de BD**: se almacena en el keychain del sistema operativo vía `keytar`
- **Token de GitHub**: mismo mecanismo, opcional para auto-updates
- **.env**: solo contiene valores no sensibles (host, puerto, nombre de BD, usuario)
- **OpenCode config**: usa `{"type":"local","command":["yhat-mcp","start"]}`; nunca incluye secretos ni rutas del source

### Control de acceso

- **Read-only estricto**: solo `SELECT`. Cualquier `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `CREATE`, `DROP` es bloqueado por el Query Guard
- **Whitelist obligatorio**: solo se puede consultar tablas explicitamente configuradas por esquema
- **Límite de filas**: configurable, evita consultas que devuelvan millones de filas
- **Timeout de consulta**: 30 segundos por defecto, evita queries lentas bloqueando el asistente

### Auditoría

Cada consulta ejecutada queda registrada como metadata y SQL redacted/normalizado: timestamp, usuario, tablas consultadas, filas devueltas, duración y una versión sanitizada de la consulta. No se registran literales sensibles ni resultados.

## Configuración

El archivo de configuración vive en la carpeta estable del usuario:

- Linux / macOS: `~/.local/share/yhat-mcp/config/yhat-mcp-config.yaml`
- Windows: `%LOCALAPPDATA%\yhat-mcp\config\yhat-mcp-config.yaml`

Si necesitás otra raíz, definí `YHAT_CONFIG_ROOT`.

```yaml
server:
  name: yhat-mcp-server
  transport: stdio

database:
  host: ${YHAT_DB_HOST}
  port: 1433
  name: ${YHAT_DB_NAME}
  user: ${YHAT_DB_USER}
  passwordEnv: YHAT_DB_PASSWORD  # leída del keychain
  encrypt: true
  trustServerCertificate: false

whitelist:
  - schema: SDK
    tables:
      - ApiObject
      - Clientes
      - DriveItem
      - MailMessage
    mode: read_only
  - schema: dbo
    tables:
      - FACodes
    mode: read_only

limits:
  maxRows: 1000
  queryTimeoutSeconds: 30
  largeTableColumnThreshold: 25
  largeTableRowThreshold: 100000

audit:
  logDir: logs
  maxSizeMb: 50
  maxAgeDays: 30
  logLevel: info
```

Podés modificar el whitelist con `yhat-mcp config` o editando el archivo directamente.

## Auto-update

El servidor puede actualizarse automáticamente desde GitHub Releases:

```bash
yhat-mcp update
```

Cada usuario necesita un token de GitHub con permiso de lectura al repositorio. Se configura durante el `setup` o puede agregarse después:

```bash
yhat-mcp setup  # vuelve a correr el wizard, pregunta el token
```

El servidor también chequea actualizaciones silenciosamente al iniciar con `yhat-mcp start`.

## Desarrollo

```bash
git clone https://github.com/ArcKelMiranda/yhat-mcp-server.git
cd yhat-mcp-server
npm install

# Compilar el CLI
npm run build:cli

# Modo desarrollo (hot reload)
npm run dev

# TypeScript check
npm run lint
```

### Stack

- **Runtime**: Node.js 20+ con TypeScript
- **MCP SDK**: `@modelcontextprotocol/server` v2
- **Base de datos**: `mssql` v12 (conexión TDS parametrizada)
- **Parser SQL**: `node-sql-parser` (análisis AST)
- **Config**: `zod` v4 + `js-yaml`
- **Keychain**: `keytar` (Windows Credential Manager / macOS Keychain / libsecret)
- **Build**: `tsup` (CJS bundle para CLI)

## Licencia

Privado — Yhat Data Team.
