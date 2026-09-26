// Write the JSON form of every CloudFormation golden's fixture into <out-dir>,
// for scripts/check-yaml-11.py to compare against the YAML goldens under a
// YAML 1.1 parser. Renders through the BUILT package (`pnpm build` first), so
// the parity check covers what ships; the specifier is a variable because tsc
// would otherwise need dist/ to exist at typecheck time.
//
//   node scripts/render-cfn-json.ts <out-dir>
import {mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {GOLDENS, goldenInput} from '../tests/helpers/goldens.ts';

const distEntry = pathToFileURL(resolve(import.meta.dirname, '..', 'dist', 'index.js')).href;
const {emitCloudFormation} = (await import(distEntry)) as typeof import('../src/index.ts');

const outDir = process.argv[2];
if (outDir === undefined) throw new Error('usage: node scripts/render-cfn-json.ts <out-dir>');
mkdirSync(outDir, {recursive: true});

const goldens = resolve(import.meta.dirname, '..', 'tests', 'golden', 'cloudformation');
for (const file of readdirSync(goldens).filter((f) => f.endsWith('.yaml'))) {
  const name = file.slice(0, -'.yaml'.length);
  if (GOLDENS[name] === undefined) throw new Error(`${name}: not in tests/fixtures/goldens.json`);
  const result = emitCloudFormation(goldenInput(name), {syntax: 'json'});
  if (!result.ok) throw new Error(`${name}: ${result.reason}`);
  writeFileSync(join(outDir, `${name}.json`), result.code);
}
console.log(`rendered JSON for ${readdirSync(outDir).length} goldens into ${outDir}`);
