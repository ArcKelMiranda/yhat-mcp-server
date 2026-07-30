# Cambiar Spec: query-guard

## Propósito adicional

Esta capability fija, mediante pruebas unitarias, el comportamiento actual de `classifyQuery()` y `authorizeQueryTables()` para evitar regresiones por refactors o por cambios en `node-sql-parser`. Aunque la exploración empírica confirmó que no existe un bypass real en referencias profundas, estas pruebas bloquean dos quirks conocidos: el alias de CTE aparece en `classification.tables` y `mode` en la whitelist no altera la decisión.

## Requisitos adicionales

### Requirement: El validador captura referencias profundas en `classification.tables`

The system SHALL include every tabla referenciada en cualquier profundidad relevante del AST dentro de `classification.tables`.

#### Scenario: SELECT simple captura una tabla
- **Dado** un SQL `SELECT * FROM dbo.users`
- **Cuando** se llama `classifyQuery()`
- **Entonces** `classification.tables = [dbo.users]`

#### Scenario: UNION captura ambas ramas
- **Dado** un SQL `SELECT * FROM dbo.users UNION SELECT * FROM dbo.orders`
- **Cuando** se llama `classifyQuery()`
- **Entonces** `classification.tables` contiene `dbo.users` y `dbo.orders`

#### Scenario: UNION ALL captura ambas ramas
- **Dado** un SQL `SELECT * FROM dbo.users UNION ALL SELECT * FROM dbo.orders`
- **Cuando** se llama `classifyQuery()`
- **Entonces** `classification.tables` contiene `dbo.users` y `dbo.orders`

#### Scenario: Subquery IN captura ambos niveles
- **Dado** un SQL `SELECT * FROM dbo.orders WHERE customer_id IN (SELECT id FROM dbo.blacklist)`
- **Cuando** se llama `classifyQuery()`
- **Entonces** `classification.tables` contiene `dbo.orders` y `dbo.blacklist`

#### Scenario: CTE incluye el alias en la lista de tablas
- **Dado** un SQL `WITH x AS (SELECT * FROM dbo.users) SELECT * FROM x`
- **Cuando** se llama `classifyQuery()`
- **Entonces** `classification.tables` contiene `dbo.users` y también `x`

#### Scenario: JOIN captura ambas tablas
- **Dado** un SQL `SELECT * FROM dbo.users u JOIN dbo.orders o ON u.id = o.user_id`
- **Cuando** se llama `classifyQuery()`
- **Entonces** `classification.tables` contiene `dbo.users` y `dbo.orders`

### Requirement: La whitelist autoriza solo tablas incluidas y bloquea la primera ausencia

The system SHALL block authorization when any table in `classification.tables` is absent from the whitelist, and SHALL stop at the first missing table.

#### Scenario: Whitelist vacío bloquea un SELECT simple
- **Dado** una whitelist vacía y `classification.tables = [dbo.users]`
- **Cuando** se llama `authorizeQueryTables()`
- **Entonces** el resultado es BLOCKED con `whitelist_denied`

#### Scenario: Whitelist exacto autoriza un SELECT simple
- **Dado** una whitelist con `dbo.users`
- **Cuando** se autoriza `SELECT * FROM dbo.users`
- **Entonces** el resultado es ALLOWED

#### Scenario: UNION parcial bloquea la tabla faltante
- **Dado** una whitelist con solo `dbo.users`
- **Cuando** se autoriza `SELECT * FROM dbo.users UNION SELECT * FROM dbo.orders`
- **Entonces** el resultado es BLOCKED y el mensaje nombra `dbo.orders`

#### Scenario: CTE bloquea el alias no whitelisteado
- **Dado** una whitelist con solo `dbo.users`
- **Cuando** se autoriza `WITH x AS (SELECT * FROM dbo.users) SELECT * FROM x`
- **Entonces** el resultado es BLOCKED sobre `x`

#### Scenario: JOIN bloquea la tabla faltante de la derecha
- **Dado** una whitelist con solo `dbo.users`
- **Cuando** se autoriza `SELECT * FROM dbo.users u JOIN dbo.orders o ON u.id = o.user_id`
- **Entonces** el resultado es BLOCKED sobre `dbo.orders`

#### Scenario: Identificador sin schema con colisión es rechazado
- **Dado** una whitelist con `dbo.users` y `sdk.users`
- **Cuando** se autoriza `SELECT * FROM users`
- **Entonces** el resultado es BLOCKED por ambigüedad

#### Scenario: Identificadores con corchetes se normalizan
- **Dado** una whitelist con `dbo.users`
- **Cuando** se autoriza `SELECT * FROM [dbo].[users]`
- **Entonces** el resultado es ALLOWED

#### Scenario: Identificadores entre comillas se normalizan
- **Dado** una whitelist con `dbo.users`
- **When** se autoriza `SELECT * FROM "dbo"."users"`
- **Entonces** el resultado es ALLOWED

### Requirement: El campo `mode` no altera la autorización

The system SHALL NOT use the `mode` field of a whitelist entry to change the authorization decision.

#### Scenario: `mode: read_only` sigue autorizando SELECT
- **Dado** una whitelist con `{ schema: 'dbo', tables: ['users'], mode: 'read_only' }`
- **Cuando** se autoriza `SELECT * FROM dbo.users`
- **Entonces** el resultado es ALLOWED

#### Scenario: `mode: read_write` sigue autorizando SELECT
- **Dado** una whitelist con `{ schema: 'dbo', tables: ['users'], mode: 'read_write' }`
- **Cuando** se autoriza `SELECT * FROM dbo.users`
- **Entonces** el resultado es ALLOWED

### Requirement: El validador bloquea SQL vacío o inválido

The system SHALL return `parse_error` for empty or syntactically invalid SQL.

#### Scenario: SQL vacío devuelve parse_error
- **Dado** un string SQL vacío
- **Cuando** se llama `classifyQuery()`
- **Entonces** el resultado es BLOCKED con `parse_error`

#### Scenario: SQL inválido devuelve parse_error
- **Dado** un SQL `MALFORMED SQL FROM`
- **Cuando** se llama `classifyQuery()`
- **Entonces** el resultado es BLOCKED con `parse_error`
