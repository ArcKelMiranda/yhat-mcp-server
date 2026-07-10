import * as sqlParser from "node-sql-parser";

import {
  BLOCK_RULE,
  STATEMENT_TYPE,
  type BlockReason,
  type QueryClassification,
  type QueryGuardResult,
  type TableReference,
} from "./types.js";

const SQL_DIALECT = "TransactSQL" as const;

type ParserConstructor = new () => {
  astify(sql: string, opt?: { database?: string }): unknown;
  parse(sql: string, opt?: { database?: string }): unknown;
};

const Parser = resolveParserConstructor(sqlParser);
const parser = new Parser();

interface ParsedQueryMetadata {
  readonly ast: unknown;
  readonly tableList?: readonly string[];
  readonly columnList?: readonly string[];
}

export function classifyQuery(sql: string): QueryGuardResult {
  const trimmedQuery = sql.trim();

  if (trimmedQuery.length === 0) {
    return blockResult(buildEmptyQueryClassification(), BLOCK_RULE.PARSE_ERROR, "SQL query cannot be empty");
  }

  try {
    const ast = parser.astify(trimmedQuery, { database: SQL_DIALECT });

    if (Array.isArray(ast)) {
      return blockResult(buildEmptyQueryClassification(), BLOCK_RULE.MULTI_STATEMENT, "Multiple SQL statements are not allowed");
    }

    const parsed = parser.parse(trimmedQuery, { database: SQL_DIALECT }) as ParsedQueryMetadata;
    const classification = classifyParsedQuery(parsed);

    if (classification.type === STATEMENT_TYPE.SELECT) {
      return {
        allowed: true,
        classification,
      };
    }

    if (classification.type === STATEMENT_TYPE.DML && classification.isAlwaysTrueWhere) {
      return blockResult(
        classification,
        BLOCK_RULE.UNSAFE_WHERE,
        "UPDATE and DELETE statements must use a restrictive WHERE clause",
      );
    }

    if (classification.type === STATEMENT_TYPE.DML) {
      return blockResult(classification, BLOCK_RULE.NON_SELECT, "Only SELECT statements are allowed in Phase 1");
    }

    if (classification.type === STATEMENT_TYPE.DDL) {
      return blockResult(classification, BLOCK_RULE.NON_SELECT, "DDL statements are not allowed in Phase 1");
    }

    return blockResult(classification, BLOCK_RULE.NON_SELECT, "Only SELECT statements are allowed in Phase 1");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to parse SQL";
    return blockResult(buildEmptyQueryClassification(), BLOCK_RULE.PARSE_ERROR, message);
  }
}

export function classifyParsedQuery(parsed: ParsedQueryMetadata): QueryClassification {
  const ast = parsed.ast;
  const statementType = readStatementType(ast);
  const tables = parseTableReferences(parsed.tableList ?? []);
  const hasWhereClause = hasProperty(ast, "where");
  const isAlwaysTrueWhere = hasWhereClause ? isAlwaysTrueWhereClause(readProperty(ast, "where")) : false;
  const isSelectAll = detectSelectAll(parsed.columnList ?? [], ast);

  return {
    type: statementType,
    tables,
    hasWhereClause,
    isAlwaysTrueWhere,
    isSelectAll,
  };
}

export function parseTableReferences(tableList: readonly string[]): readonly TableReference[] {
  const tables: TableReference[] = [];

  for (const entry of tableList) {
    const reference = parseTableReference(entry);

    if (reference !== null) {
      tables.push(reference);
    }
  }

  return tables;
}

function parseTableReference(value: string): TableReference | null {
  const parts = value.split("::");

  if (parts.length < 2) {
    return null;
  }

  const tableName = normalizeIdentifier(parts[parts.length - 1] ?? "");

  if (tableName.length === 0) {
    return null;
  }

  const schemaCandidate = parts.length >= 3 ? normalizeIdentifier(parts[parts.length - 2] ?? "") : "";
  const schema = schemaCandidate.length > 0 && schemaCandidate.toLowerCase() !== "null" ? schemaCandidate : undefined;

  return {
    name: tableName,
    ...(schema === undefined ? {} : { schema }),
  };
}

function readStatementType(ast: unknown): QueryClassification["type"] {
  const statementType = readStringProperty(ast, "type")?.toLowerCase() ?? "";

  if (statementType === "select") {
    return STATEMENT_TYPE.SELECT;
  }

  if (statementType === "insert" || statementType === "update" || statementType === "delete" || statementType === "merge") {
    return STATEMENT_TYPE.DML;
  }

  if (statementType === "create" || statementType === "alter" || statementType === "drop" || statementType === "truncate") {
    return STATEMENT_TYPE.DDL;
  }

  return STATEMENT_TYPE.UNKNOWN;
}

function detectSelectAll(columnList: readonly string[], ast: unknown): boolean {
  if (columnList.some((column) => column.trim().endsWith("::*"))) {
    return true;
  }

  const columns = readProperty(ast, "columns");
  return containsWildcard(columns);
}

function containsWildcard(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsWildcard(item));
  }

  if (!isRecord(value)) {
    return false;
  }

  const type = readStringProperty(value, "type")?.toLowerCase();

  if (type === "column_ref") {
    const columnName = readStringProperty(value, "column") ?? "";
    return columnName === "*";
  }

  for (const nestedValue of Object.values(value)) {
    if (containsWildcard(nestedValue)) {
      return true;
    }
  }

  return false;
}

function hasProperty(value: unknown, propertyName: string): boolean {
  return isRecord(value) && propertyName in value;
}

function readProperty(value: unknown, propertyName: string): unknown {
  if (!isRecord(value)) {
    return undefined;
  }

  return value[propertyName];
}

function readStringProperty(value: unknown, propertyName: string): string | undefined {
  const propertyValue = readProperty(value, propertyName);
  return typeof propertyValue === "string" ? propertyValue : undefined;
}

function isAlwaysTrueWhereClause(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1 = 1" || normalized === "1=1";
  }

  if (!isRecord(value)) {
    return false;
  }

  const type = readStringProperty(value, "type")?.toLowerCase() ?? "";

  if (type === "bool") {
    const literal = value.value;
    return literal === true || literal === 1 || literal === "true";
  }

  if (type === "binary_expr") {
    const operator = readStringProperty(value, "operator")?.toLowerCase() ?? "";
    const leftValue = readProperty(value, "left");
    const rightValue = readProperty(value, "right");

    if (operator === "and") {
      return isAlwaysTrueWhereClause(leftValue) && isAlwaysTrueWhereClause(rightValue);
    }

    if (operator === "or") {
      return isAlwaysTrueWhereClause(leftValue) || isAlwaysTrueWhereClause(rightValue);
    }

    const leftLiteral = readLiteralValue(leftValue);
    const rightLiteral = readLiteralValue(rightValue);

    if (leftLiteral !== undefined && rightLiteral !== undefined) {
      if (operator === "=" || operator === "==") {
        return leftLiteral === rightLiteral;
      }

      if (operator === "<>" || operator === "!=") {
        return leftLiteral !== rightLiteral;
      }
    }
  }

  if (type === "unary_expr") {
    const operator = readStringProperty(value, "operator")?.toLowerCase() ?? "";

    if (operator === "not") {
      const innerValue = readProperty(value, "expr") ?? readProperty(value, "value");
      return !isAlwaysTrueWhereClause(innerValue);
    }
  }

  return false;
}

function resolveParserConstructor(module: typeof sqlParser): ParserConstructor {
  const resolved =
    (module as { Parser?: ParserConstructor; default?: { Parser?: ParserConstructor } }).Parser ??
    (module as { default?: { Parser?: ParserConstructor } }).default?.Parser;

  if (resolved === undefined) {
    throw new Error("node-sql-parser Parser export not found");
  }

  return resolved;
}

function readLiteralValue(value: unknown): string | number | boolean | null | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const type = readStringProperty(value, "type")?.toLowerCase() ?? "";

  if (type === "number") {
    const rawValue = value.value;
    if (typeof rawValue === "number") {
      return rawValue;
    }

    if (typeof rawValue === "string") {
      const parsedNumber = Number(rawValue);
      return Number.isFinite(parsedNumber) ? parsedNumber : undefined;
    }

    return undefined;
  }

  if (type === "bool") {
    const rawValue = value.value;
    if (rawValue === true || rawValue === 1 || rawValue === "true") {
      return true;
    }

    if (rawValue === false || rawValue === 0 || rawValue === "false") {
      return false;
    }

    return undefined;
  }

  if (type === "single_quote_string" || type === "double_quote_string" || type === "string") {
    const rawValue = value.value;
    return typeof rawValue === "string" ? rawValue : undefined;
  }

  if (type === "null") {
    return null;
  }

  return undefined;
}

function buildEmptyQueryClassification(): QueryClassification {
  return {
    type: STATEMENT_TYPE.UNKNOWN,
    tables: [],
    hasWhereClause: false,
    isAlwaysTrueWhere: false,
    isSelectAll: false,
  };
}

function blockResult(classification: QueryClassification, rule: BlockReason["rule"], message: string): QueryGuardResult {
  return {
    allowed: false,
    classification,
    reason: {
      rule,
      message,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
