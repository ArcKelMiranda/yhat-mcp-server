# Design: whitelist-regression-coverage

## Objetivos

Este cambio es **solo de pruebas**: fija el comportamiento actual de `classifyQuery()` y `authorizeQueryTables()` para evitar regresiones en referencias profundas, normalización de identificadores y colisión de esquemas.

Queda explícitamente fuera de alcance tocar `src/`, cambiar la semántica de `mode`, corregir el alias de CTE, actualizar `node-sql-parser` o modificar `package.json`.

## Module layout

### Added

- `tests/validator.test.ts` — pruebas unitarias de `classifyQuery()` para los 6 escenarios de referencias profundas y los casos límite de parseo.
- `tests/whitelist.test.ts` — pruebas unitarias de `authorizeQueryTables()` para autorización, denegación, normalización y colisión.

### Modified

- (none)

## Test architecture

Las pruebas usarán el patrón existente del repositorio: `node:test` con `describe`/`it` y `node:assert/strict`.
No habrá mocks ni fixtures de filesystem; se invoca `node-sql-parser` real y las entradas de whitelist se declaran inline.

```ts
import { describe, it } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert/strict";

import { classifyQuery } from "../src/validator.js";
import { authorizeQueryTables } from "../src/whitelist.js";
import type { WhitelistEntry } from "../src/types.js";
```

Para comparar tablas, las pruebas deben normalizar a cadenas y comparar conjuntos ordenados cuando el parser no garantice orden estable.

## Scenario → test mapping

| Spec scenario | Test file:line | Test description |
|---|---|---|
| SELECT simple captura una tabla | `tests/validator.test.ts:~L1-L20` | `validator captures single FROM table` |
| UNION captura ambas ramas | `tests/validator.test.ts:~L21-L40` | `validator captures tables in UNION branches` |
| UNION ALL captura ambas ramas | `tests/validator.test.ts:~L41-L60` | `validator captures tables in UNION ALL branches` |
| Subquery IN captura ambos niveles | `tests/validator.test.ts:~L61-L80` | `validator captures tables in IN subquery` |
| CTE incluye alias en classification.tables | `tests/validator.test.ts:~L81-L100` | `validator captures CTE source and alias` |
| JOIN captura ambas tablas | `tests/validator.test.ts:~L101-L120` | `validator captures tables in JOIN` |
| SQL vacío devuelve `parse_error` | `tests/validator.test.ts:~L121-L140` | `validator rejects empty input with parse_error` |
| SQL inválido devuelve `parse_error` | `tests/validator.test.ts:~L141-L160` | `validator rejects malformed SQL with parse_error` |
| Whitelist vacío bloquea SELECT simple | `tests/whitelist.test.ts:~L1-L20` | `denies simple SELECT without whitelist entry` |
| Whitelist exacto autoriza SELECT simple | `tests/whitelist.test.ts:~L21-L40` | `allows single-table SELECT when whitelisted` |
| UNION parcial bloquea la tabla faltante | `tests/whitelist.test.ts:~L41-L60` | `UNION blocks on missing second branch` |
| CTE bloquea el alias no whitelisteado | `tests/whitelist.test.ts:~L61-L80` | `locks current CTE-alias behavior` |
| JOIN bloquea la tabla derecha faltante | `tests/whitelist.test.ts:~L81-L100` | `denies JOIN when second table missing` |
| Identificador sin schema con colisión se rechaza | `tests/whitelist.test.ts:~L101-L120` | `rejects ambiguous unqualified table` |
| Identificadores con corchetes se normalizan | `tests/whitelist.test.ts:~L121-L140` | `normalizes bracketed identifiers` |
| Identificadores entre comillas se normalizan | `tests/whitelist.test.ts:~L141-L160` | `normalizes quoted identifiers` |
| `mode: read_only` no altera la autorización | `tests/whitelist.test.ts:~L161-L180` | `ignores read_only mode` |
| `mode: read_write` no altera la autorización | `tests/whitelist.test.ts:~L181-L200` | `ignores read_write mode` |

## Test file structure

### `tests/validator.test.ts`

- `describe("classifier — shape", ...)`
  - `it("captures the single FROM table for plain SELECT", ...)`
  - `it("captures tables in UNION branches", ...)`
  - `it("captures tables in UNION ALL branches", ...)`
  - `it("captures tables in IN subquery", ...)`
  - `it("captures tables in CTE source and alias", ...)`
  - `it("captures tables in JOIN", ...)`
- `describe("classifier — parse errors", ...)`
  - `it("rejects empty input with parse_error", ...)`
  - `it("rejects malformed SQL with parse_error", ...)`

### `tests/whitelist.test.ts`

- `describe("whitelist — authorized cases", ...)`
  - `it("allows single-table SELECT when whitelisted", ...)`
  - `it("allows UNION when both branches are whitelisted", ...)`
  - `it("allows JOIN when both tables are whitelisted", ...)`
  - `it("allows CTE when source and alias are both whitelisted", ...)`
- `describe("whitelist — denied cases", ...)`
  - `it("denies UNION when the second branch is missing", ...)`
  - `it("denies IN subquery when the inner table is missing", ...)`
  - `it("denies JOIN when the right table is missing", ...)`
  - `it("denies CTE when alias is not whitelisted", ...)`
- `describe("whitelist — identifier normalization", ...)`
  - `it("normalizes bracketed identifiers", ...)`
  - `it("normalizes quoted identifiers", ...)`
  - `it("matches identifiers case-insensitively", ...)`
- `describe("whitelist — collision", ...)`
  - `it("rejects unqualified table ambiguity across schemas", ...)`
- `describe("whitelist — mode field", ...)`
  - `it("ignores mode: read_only in authorization decision", ...)`
  - `it("ignores mode: read_write in authorization decision", ...)`

## Non-production guarantees

- No cambios en `src/`.
- No cambios en `package.json`.
- No cambio de versión de parser.
- No I/O externo, no DB, no mocks.

## Risks

- **Bajo**: dependencia de orden en listas de tablas. Mitigación: comparar conjuntos normalizados o listas ordenadas.
- **Bajo**: la forma del AST puede variar si cambia `node-sql-parser`. Mitigación: las pruebas validan comportamiento observable, no la estructura interna del AST.
- **Bajo**: el escenario de CTE con alias documenta un quirk actual que podría querer corregirse en el futuro. Mitigación: mantenerlo como regresión explícita y separarlo de cualquier cambio correctivo.

## Open questions

- ¿Se prefiere un helper local mínimo para construir `WhitelistEntry[]` o entradas inline en cada test? Recomendación: inline.
- ¿Conviene agrupar los asserts de tablas en un helper local de normalización? Recomendación: sí, pero solo dentro de `tests/validator.test.ts`.

## Completion criteria

- Existen `tests/validator.test.ts` y `tests/whitelist.test.ts`.
- `npm test` pasa completo.
- `npm run lint` y `npm run build:cli` pasan.
- `git diff --stat` no muestra cambios bajo `src/` ni `package.json`.

## Diff forecast

- `tests/validator.test.ts`: ~80 líneas
- `tests/whitelist.test.ts`: ~110 líneas
- Total: ~190 líneas
