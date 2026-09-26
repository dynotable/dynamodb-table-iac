import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {DescribeTableTable, TableDefinitionInput, TimeToLiveDescription} from '../../src/types';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

export function fixtureTable(name: string): DescribeTableTable {
  const raw = JSON.parse(readFileSync(join(FIXTURES, `${name}.describe.json`), 'utf8')) as {
    Table: DescribeTableTable;
  };
  return raw.Table;
}

export function fixtureTtl(name: string): TimeToLiveDescription {
  const raw = JSON.parse(readFileSync(join(FIXTURES, `${name}.ttl.json`), 'utf8')) as {
    TimeToLiveDescription: TimeToLiveDescription;
  };
  return raw.TimeToLiveDescription;
}

/** A fixture as `TableDefinitionInput`, with the TTL sidecar when the fixture has one. */
export function fixtureInput(
  name: string,
  overrides: Partial<Omit<TableDefinitionInput, 'table'>> = {}
): TableDefinitionInput {
  let timeToLive: TimeToLiveDescription | undefined;
  try {
    timeToLive = fixtureTtl(name);
  } catch (error) {
    // Only a missing sidecar means "not provided"; a malformed one is a broken fixture.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    timeToLive = undefined;
  }
  return {table: fixtureTable(name), timeToLive, ...overrides};
}
