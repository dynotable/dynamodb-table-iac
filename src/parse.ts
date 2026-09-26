import type {DescribeTableTable} from './types';

export type ParseResult = {ok: true; table: DescribeTableTable} | {ok: false; reason: string};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Turn pasted `aws dynamodb describe-table` output into the `Table` object.
 * Accepts the CLI envelope (`{"Table": {…}}`) or a bare `Table`. This is the
 * only shape check the parser makes — everything about the table's CONTENT
 * (keys, definitions, statuses, names) is judged by `normalize()`, so the
 * paste and the SDK path share one set of refusals.
 */
export function parseDescribeTableJson(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {ok: false, reason: `The text is not valid JSON (${detail}).`};
  }
  if (!isPlainObject(value)) {
    return {
      ok: false,
      reason: 'Expected a JSON object — the output of `aws dynamodb describe-table`.'
    };
  }
  if ('Table' in value) {
    if (!isPlainObject(value.Table)) {
      return {ok: false, reason: 'The "Table" field must be an object.'};
    }
    return {ok: true, table: value.Table as DescribeTableTable};
  }
  if ('TableName' in value || 'KeySchema' in value) {
    return {ok: true, table: value as DescribeTableTable};
  }
  return {
    ok: false,
    reason:
      'This does not look like describe-table output: expected a "Table" object or a table with "TableName" and "KeySchema".'
  };
}
