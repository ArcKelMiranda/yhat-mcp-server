# Cambiar: whitelist-regression-coverage

## Por qué

El proyecto no tiene pruebas unitarias dedicadas para `src/validator.ts` ni `src/whitelist.ts`. El comportamiento actual ya fue verificado empíricamente en la exploración, pero un refactor, una actualización del parser o un cambio menor podría romper la lógica de referencias profundas sin advertencia. Esta propuesta agrega una red de regresión para fijar el comportamiento actual.

## Qué cambia

### Nuevo

- `tests/validator.test.ts` — pruebas unitarias para `classifyQuery()` con los 6 escenarios principales de referencias profundas y casos límite: consulta vacía, identificadores con corchetes y alias.
- `tests/whitelist.test.ts` — pruebas unitarias para `authorizeQueryTables()` con decisiones permitidas y denegadas en los mismos 6 escenarios, más colisión de esquema, normalización de corchetes y el comportamiento actual del campo `mode`.

### Capacidades

#### Nuevas

- Ninguna.

#### Modificadas

- Ninguna.

## Casos fuera de alcance

1. Corregir el comportamiento de `CTE` que agrega el alias a `tableList`.
2. Implementar semántica real para `mode: read_only` en `authorizeQueryTables()`.
3. Cambios en `src/` o en cualquier archivo de producción.
4. Dependencias nuevas o cambios en `package.json`.
5. Ajustes a `node-sql-parser`.
6. `doctor --validate`, `queryTimeout`, límite por `TOP/OFFSET`, rotación de auditoría, rate limiting o audit sink central.

## Affected Areas

| Área | Impacto | Descripción |
|------|--------|-------------|
| `tests/validator.test.ts` | New | Cubre la clasificación de consultas y fija el comportamiento actual de referencias profundas. |
| `tests/whitelist.test.ts` | New | Cubre autorización por whitelist y fija decisiones actuales, incluida la ignorancia de `mode`. |

## Riesgos y mitigaciones

- Bajo: cambio test-only con criterio strict TDD green-first; las pruebas deben pasar desde el inicio porque fijan el comportamiento actual.
- Bajo: futuras modificaciones de `validator` o `whitelist` exigirán actualizar estas pruebas; es el objetivo de la regresión.
- Bajo: puede existir solapamiento parcial con otros tests; la cobertura dedicada mejora legibilidad y mantenimiento.

## Plan de reversión

Eliminar `tests/validator.test.ts` y `tests/whitelist.test.ts`. No hay cambios de producción que revertir.

## Dependencias

- Ninguna.

## Criterios de aceptación

- Se agregan las dos nuevas pruebas unitarias.
- `npm test` pasa sin fallos.
- Ningún archivo en `src/` cambia.
- No se agregan dependencias nuevas.
- El comportamiento actual queda fijado, incluyendo el alias de CTE en `tableList` y el `mode` ignorado.

## Plan de alto nivel

Cambio pequeño en una sola PR. Una confirmación por archivo de prueba. No requiere dividir en entregas encadenadas.

## Decisiones de producto cerradas

1. El alcance es de consolidación בלבד: las pruebas reflejan el comportamiento actual.
2. No habrá cambios de código en producción.
3. No habrá dependencias nuevas.
