import {
  BLOCK_RULE,
  STATEMENT_TYPE,
  type QueryClassification,
  type TableReference,
  type WhitelistDecision,
  type WhitelistEntry,
} from "./types.js";

export function authorizeQueryTables(
  classification: QueryClassification,
  whitelist: readonly WhitelistEntry[],
): WhitelistDecision {
  if (classification.type !== STATEMENT_TYPE.SELECT) {
    return {
      allowed: false,
      matchedTables: [],
      reason: {
        rule: BLOCK_RULE.NON_SELECT,
        message: "Only SELECT statements are allowed in Phase 1",
      },
    };
  }

  const matchedTables: TableReference[] = [];

  for (const table of classification.tables) {
    const match = findWhitelistMatch(table, whitelist);

    if (match === null) {
      return {
        allowed: false,
        matchedTables,
        reason: {
          rule: BLOCK_RULE.WHITELIST_DENIED,
          message: formatWhitelistError(table, whitelist),
        },
      };
    }

    matchedTables.push(table);
  }

  return {
    allowed: true,
    matchedTables,
  };
}

function findWhitelistMatch(table: TableReference, whitelist: readonly WhitelistEntry[]): WhitelistEntry | null {
  if (table.schema !== undefined) {
    return whitelist.find((entry) => matchesSchemaTable(entry, table.schema ?? "", table.name)) ?? null;
  }

  const matches = whitelist.filter((entry) => entry.tables.some((candidate) => normalizeIdentifier(candidate).toLowerCase() === normalizeIdentifier(table.name).toLowerCase()));

  if (matches.length !== 1) {
    return null;
  }

  return matches[0] ?? null;
}

function matchesSchemaTable(entry: WhitelistEntry, schemaName: string, tableName: string): boolean {
  return (
    normalizeIdentifier(entry.schema).toLowerCase() === normalizeIdentifier(schemaName).toLowerCase() &&
    entry.tables.some((candidate) => normalizeIdentifier(candidate).toLowerCase() === normalizeIdentifier(tableName).toLowerCase())
  );
}

function formatWhitelistError(table: TableReference, whitelist: readonly WhitelistEntry[]): string {
  const qualifiedName = table.schema !== undefined ? `${table.schema}.${table.name}` : table.name;

  if (table.schema === undefined) {
    const matches = whitelist.filter((entry) =>
      entry.tables.some((candidate) => normalizeIdentifier(candidate).toLowerCase() === normalizeIdentifier(table.name).toLowerCase()),
    );

    if (matches.length > 1) {
      return `Unqualified table "${table.name}" matches multiple whitelist entries. Use a schema-qualified name.`;
    }
  }

  return `Table "${qualifiedName}" is not whitelisted`;
}

function normalizeIdentifier(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length >= 2) {
    const firstCharacter = trimmed[0];
    const lastCharacter = trimmed[trimmed.length - 1];

    if (
      (firstCharacter === "[" && lastCharacter === "]") ||
      (firstCharacter === '"' && lastCharacter === '"') ||
      (firstCharacter === "`" && lastCharacter === "`")
    ) {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}
