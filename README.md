# yhat-mcp-server

Servidor MCP (Model Context Protocol) que permite a asistentes de IA como OpenCode, Claude, Cursor y VS Code consultar Microsoft SQL Server de forma segura y controlada.

## Motivación

El equipo de datos de Yhat necesita que sus asistentes de IA puedan acceder a la base de datos SQL Server para responder preguntas, analizar datos y generar reportes — sin exponer credenciales, sin permitir escritura accidental, y sin que cada usuario tenga que configurar herramientas manualmente.

Este servidor resuelve eso con una arquitectura distribuida (cada usuario ejecuta su propia instancia local vía stdio), autenticación segura mediante keychain del SO, y un sistema de whitelist por esquema/tabla.

## Instalación

Requiere Node.js 20+.

### Desde npm (recomendado)

```bash
npm install -g @yhat/mcp-server
yhat-mcp setup
```

### Windows — instalador PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

### Linux / macOS — instalador bash

```bash
bash install.sh
```

### Desde el release

Descargá el zip correspondiente a tu plataforma desde [GitHub Releases](https://github.com/ArcKelMiranda/yhat-mcp-server/releases), extraelo y ejecutá:

```bash
# Linux/macOS
./yhat-mcp setup

# Windows
yhat-mcp.exe setup
```

## Primeros pasos

El CLI tiene un asistente interactivo que te guía por toda la configuración:

```bash
yhat-mcp setup
```

El wizard te va a pedir:

1. **Conexión a SQL Server** — host, puerto, base de datos, usuario, contraseña
2. **Whitelist** — qué esquemas y tablas querés habilitar para consultas
3. **Token de GitHub** — opcional, para recibir actualizaciones automáticas
4. **Instalación en OpenCode** — crea la entrada MCP automáticamente

La contraseña de la base de datos se almacena en el keychain del SO (Windows Credential Manager, macOS Keychain, libsecret en Linux). Nunca queda en texto plano.

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
- **OpenCode config**: referencia las variables de entorno con sintaxis `${VAR}`, nunca valores reales

### Control de acceso

- **Read-only estricto**: solo `SELECT`. Cualquier `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `CREATE`, `DROP` es bloqueado por el Query Guard
- **Whitelist obligatorio**: solo se puede consultar tablas explicitamente configuradas por esquema
- **Límite de filas**: configurable, evita consultas que devuelvan millones de filas
- **Timeout de consulta**: 30 segundos por defecto, evita queries lentas bloqueando el asistente

### Auditoría

Cada consulta ejecutada queda registrada (solo metadata: timestamp, usuario, tablas consultadas, filas devueltas, duración). No se registra el contenido de los resultados ni datos sensibles.

## Configuración

El archivo de configuración vive en `config/yhat-mcp-config.yaml`:

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
