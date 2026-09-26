import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {describe, expect, it} from 'vitest';

// The built entry points load in both module systems and expose exactly the
// documented public API — the set that semver protects once 0.1.0 is out. Any
// other export in src/index.ts is a public promise made by accident.
const ROOT = join(import.meta.dirname, '..');
const PUBLIC_API = ['NOT_EMITTED', 'emitCdk', 'emitCloudFormation', 'emitTerraform', 'parseDescribeTableJson'];

describe('built package', () => {
  execFileSync(join(ROOT, 'node_modules', '.bin', 'tsdown'), [], {cwd: ROOT, stdio: 'ignore'});

  it('ESM entry point loads and exports the documented API only', async () => {
    const mod = (await import(pathToFileURL(join(ROOT, 'dist', 'index.js')).href)) as Record<string, unknown>;
    expect(Object.keys(mod).sort()).toEqual(PUBLIC_API);
    expect(typeof mod.emitTerraform).toBe('function');
  });

  it('CJS entry point loads and exports the documented API only', () => {
    const require = createRequire(import.meta.url);
    const mod = require(join(ROOT, 'dist', 'index.cjs')) as Record<string, unknown>;
    expect(Object.keys(mod).sort()).toEqual(PUBLIC_API);
    expect(Array.isArray(mod.NOT_EMITTED)).toBe(true);
  });
});
