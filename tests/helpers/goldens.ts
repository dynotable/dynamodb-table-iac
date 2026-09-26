import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TableDefinitionInput} from '../../src/types';
import {fixtureInput} from './fixtures';

// tests/fixtures/goldens.json is the ONE record of which fixture each golden is
// emitted from and with which `input.region` (absent = region-less). The three
// emitter suites, scripts/render-cfn-json.mjs and the Task 7 validators all
// read it, and PROVENANCE.md's "Golden input.region" column describes it.
export type GoldenRecord = {fixture: string; region?: string};

export const GOLDENS: Readonly<Record<string, GoldenRecord>> = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'goldens.json'), 'utf8')
) as Record<string, GoldenRecord>;

export const GOLDEN_NAMES: readonly string[] = Object.keys(GOLDENS);

/** The `TableDefinitionInput` a golden is emitted from. */
export function goldenInput(name: string): TableDefinitionInput {
  const record = GOLDENS[name];
  if (record === undefined) throw new Error(`no golden record for ${name}`);
  return fixtureInput(record.fixture, record.region === undefined ? {} : {region: record.region});
}
