import { BLOCK_RULE, STATEMENT_TYPE, type QueryClassification, type RowLimitResult, type TableStatistics } from "./types.js";

export interface RowLimitOptions {
  maxRows: number;
  largeTableColumnThreshold?: number;
  largeTableRowThreshold?: number;
}

export function enforceRowLimit(
  classification: QueryClassification,
  rowCount: number,
  options: RowLimitOptions,
  tableStatistics: readonly TableStatistics[] = [],
): RowLimitResult {
  if (classification.type !== STATEMENT_TYPE.SELECT) {
    return {
      allowed: false,
      rowCount,
      limit: options.maxRows,
      reason: {
        rule: BLOCK_RULE.NON_SELECT,
        message: "Row limits only apply to SELECT statements",
      },
    };
  }

  assertPositiveInteger(options.maxRows, "maxRows");
  assertNonNegativeInteger(rowCount, "rowCount");

  if (rowCount > options.maxRows) {
    return {
      allowed: false,
      rowCount,
      limit: options.maxRows,
      reason: {
        rule: BLOCK_RULE.ROW_LIMIT_EXCEEDED,
        message: `Returned ${rowCount} rows, which exceeds the limit of ${options.maxRows}. Narrow the query or add TOP.`,
      },
    };
  }

  const warning = buildLargeTableWarning(classification, options, tableStatistics);

  const result: RowLimitResult = {
    allowed: true,
    rowCount,
    limit: options.maxRows,
  };

  if (warning !== null) {
    result.warning = warning;
  }

  return result;
}

export function buildLargeTableWarning(
  classification: QueryClassification,
  options: RowLimitOptions,
  tableStatistics: readonly TableStatistics[],
): string | null {
  if (!classification.isSelectAll) {
    return null;
  }

  const largeTables: string[] = [];

  for (const table of classification.tables) {
    const matchingStatistic = tableStatistics.find((candidate) => matchesTable(candidate, table));

    if (matchingStatistic === undefined) {
      continue;
    }

    const columnCountExceeded =
      options.largeTableColumnThreshold !== undefined &&
      matchingStatistic.columnCount !== undefined &&
      matchingStatistic.columnCount > options.largeTableColumnThreshold;

    const rowCountExceeded =
      options.largeTableRowThreshold !== undefined &&
      matchingStatistic.estimatedRowCount !== undefined &&
      matchingStatistic.estimatedRowCount > options.largeTableRowThreshold;

    if (columnCountExceeded || rowCountExceeded) {
      largeTables.push(formatQualifiedName(table));
    }
  }

  if (largeTables.length === 0) {
    return null;
  }

  return `Broad SELECT * query targets large table(s): ${largeTables.join(", ")}. Consider selecting specific columns.`;
}

function matchesTable(statistic: TableStatistics, table: QueryClassification["tables"][number]): boolean {
  const statisticName = normalizeIdentifier(statistic.name).toLowerCase();
  const tableName = normalizeIdentifier(table.name).toLowerCase();

  if (statisticName !== tableName) {
    return false;
  }

  if (table.schema === undefined || statistic.schema === undefined) {
    return true;
  }

  return normalizeIdentifier(statistic.schema).toLowerCase() === normalizeIdentifier(table.schema).toLowerCase();
}

function formatQualifiedName(table: QueryClassification["tables"][number]): string {
  return table.schema === undefined ? table.name : `${table.schema}.${table.name}`;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
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
