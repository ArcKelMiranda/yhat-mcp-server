# Tasks: whitelist-regression-coverage

> Orden de implementación: de arriba hacia abajo. Cada tarea indica sus dependencias.
> Se aplica TDD estricto: las pruebas se escriben primero y pasarán a la primera (el comportamiento actual ya es correcto).

## PR Plan

Single PR — solo pruebas. Diff estimado: ~190 líneas (muy por debajo del umbral de revisión de 400).

El PR contiene:
- T1: `tests/validator.test.ts` (nuevo)
- T2: `tests/whitelist.test.ts` (nuevo)
- T3: descripción del PR + verificación final

Cada PR debe dejar el repositorio pasando los tres gates: `lint`, `test`, `build:cli`.

## Tasks

### 1. Pruebas unitarias del validador
- **Depende de**: ninguna
- **Archivos**: `tests/validator.test.ts` (crear)
- **Diff estimado**: ~80 líneas
- **Aceptación**:
  - [ ] Importa `classifyQuery` desde `../src/validator.js` o equivalente relativo del repo
  - [ ] Cada escenario del spec tiene su propio `test(...)` en este archivo
  - [ ] Los asserts usan `node:assert/strict` y el estilo del repositorio
  - [ ] No se modifica ningún archivo de `src/`
  - [ ] `npm test` pasa con todo en verde
- **Mapea a escenarios del spec**:
  - SELECT simple captura una tabla
  - UNION captura ambas ramas
  - UNION ALL captura ambas ramas
  - Subquery IN captura ambos niveles
  - CTE incluye el alias en la lista de tablas
  - JOIN captura ambas tablas
  - SQL vacío devuelve `parse_error`
  - SQL inválido devuelve `parse_error`

### 2. Pruebas unitarias de whitelist
- **Depende de**: ninguna
- **Archivos**: `tests/whitelist.test.ts` (crear)
- **Diff estimado**: ~110 líneas
- **Aceptación**:
  - [ ] Importa `authorizeQueryTables` desde `../src/whitelist.js` o equivalente relativo
  - [ ] Cada escenario del spec tiene su propio `test(...)` en este archivo
  - [ ] Los asserts usan `node:assert/strict` y el estilo del repositorio
  - [ ] No se modifica ningún archivo de `src/`
  - [ ] `npm test` pasa con todo en verde
- **Mapea a escenarios del spec**:
  - Whitelist vacío bloquea un SELECT simple
  - Whitelist exacto autoriza un SELECT simple
  - UNION parcial bloquea la tabla faltante
  - CTE bloquea el alias no whitelisteado
  - JOIN bloquea la tabla faltante de la derecha
  - Identificador sin schema con colisión es rechazado
  - Identificadores con corchetes se normalizan
  - Identificadores entre comillas se normalizan
  - `mode: read_only` sigue autorizando SELECT
  - `mode: read_write` sigue autorizando SELECT

### 3. Descripción del PR y verificación
- **Depende de**: 1, 2
- **Archivos**: ninguno (solo texto del PR)
- **Diff estimado**: 0 líneas
- **Aceptación**:
  - [ ] La descripción del PR deja claro que es un cambio solo de pruebas
  - [ ] La descripción indica que el comportamiento actual se fija como regresión para futuros cambios de parser/validador
  - [ ] El PR queda listo para revisión

## Review Workload Forecast

- Estimated total diff: ~190 lines (solo pruebas).
- Single PR: yes.
- 400-line budget risk: low.
- Chained PRs recommended: no.
- Estimated review time: <30 min.
- Decision needed before apply: no.

## Spec coverage check

Cada escenario de `openspec/changes/whitelist-regression-coverage/specs/query-guard/spec.md` queda mapeado exactamente una vez en T1 o T2. Cobertura del spec: 100%.
