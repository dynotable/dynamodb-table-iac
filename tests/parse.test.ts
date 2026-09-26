import {describe, expect, it} from 'vitest';
import {parseDescribeTableJson} from '../src/parse';

// The parser owns exactly one job: get from pasted text to the `Table`
// object. Expected outcomes are stated from the CLI's documented output
// shape, not from the parser.

const TABLE = {
  TableName: 'orders',
  KeySchema: [{AttributeName: 'pk', KeyType: 'HASH'}],
  AttributeDefinitions: [{AttributeName: 'pk', AttributeType: 'S'}]
};

describe('parseDescribeTableJson', () => {
  it('unwraps the CLI {"Table": …} envelope', () => {
    const result = parseDescribeTableJson(JSON.stringify({Table: TABLE}));
    expect(result).toEqual({ok: true, table: TABLE});
  });

  it('accepts a bare Table object', () => {
    const result = parseDescribeTableJson(JSON.stringify(TABLE));
    expect(result).toEqual({ok: true, table: TABLE});
  });

  it('keeps timestamps whatever shape the caller printed them in', () => {
    // CLI v2 prints ISO strings, CLI v1 with cli_timestamp_format=none prints
    // epoch numbers; neither is read, so neither may be rejected.
    const iso = parseDescribeTableJson(
      JSON.stringify({Table: {...TABLE, CreationDateTime: '2026-09-26T10:00:00+00:00'}})
    );
    const epoch = parseDescribeTableJson(
      JSON.stringify({Table: {...TABLE, CreationDateTime: 1758880800.123}})
    );
    expect(iso.ok).toBe(true);
    expect(epoch.ok).toBe(true);
  });

  it('refuses text that is not JSON', () => {
    const result = parseDescribeTableJson('TableName: orders');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not valid JSON/);
  });

  it('refuses a JSON value that is not an object', () => {
    for (const text of ['[]', '"orders"', '42', 'null']) {
      const result = parseDescribeTableJson(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/Expected a JSON object/);
    }
  });

  it('refuses a "Table" field that is not an object', () => {
    const result = parseDescribeTableJson(JSON.stringify({Table: 'orders'}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/"Table" field must be an object/);
  });

  it('refuses an object that is neither an envelope nor a table', () => {
    const result = parseDescribeTableJson(JSON.stringify({Items: [], Count: 0}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/does not look like describe-table output/);
  });
});
