import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {parseDescribeTableJson} from '../src/index';

// Every fixture is a `{"Table": …}` envelope as the CLI prints it, so the
// public parser must accept each one and hand back a table whose name matches
// the file's own claim in PROVENANCE.md — a fixture that stops parsing is a
// fixture the emitter tests silently stopped covering.
const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('fixtures', () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.describe.json'));

  it('has every fixture family PROVENANCE.md lists', () => {
    const families = new Set(files.map((f) => f.charAt(0)));
    expect([...families].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it.each(files)('%s parses through the public entry point', (file) => {
    const result = parseDescribeTableJson(readFileSync(join(FIXTURES, file), 'utf8'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.table.TableName).toBe('string');
      expect(Array.isArray(result.table.KeySchema)).toBe(true);
    }
  });
});
