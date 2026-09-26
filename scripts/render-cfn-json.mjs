// Write the JSON form of every CloudFormation golden's fixture into <out-dir>,
// for scripts/check-yaml-11.py to compare against the YAML goldens under a
// YAML 1.1 parser. Runs against the built package (`pnpm build` first).
//
//   node scripts/render-cfn-json.mjs <out-dir>
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {emitCloudFormation} from '../dist/index.js';

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: node scripts/render-cfn-json.mjs <out-dir>');
mkdirSync(outDir, {recursive: true});

const fixtures = join(import.meta.dirname, '..', 'tests', 'fixtures');
const goldens = join(import.meta.dirname, '..', 'tests', 'golden', 'cloudformation');

// The goldens that are emitted WITH a region, and the fixture each one renders
// (mirrors tests/emit-cloudformation.test.ts).
const REGION = {'a-core': 'us-east-1', 'b-provisioned': 'us-east-1', 'b-hash-only': 'us-east-1', 'c-stream': 'us-east-1'};
const ALIAS = {'i-regionless': 'b-provisioned'};

function fixtureInput(name, region) {
  const table = JSON.parse(readFileSync(join(fixtures, `${name}.describe.json`), 'utf8')).Table;
  let timeToLive;
  try {
    timeToLive = JSON.parse(readFileSync(join(fixtures, `${name}.ttl.json`), 'utf8')).TimeToLiveDescription;
  } catch {
    timeToLive = undefined;
  }
  return {table, timeToLive, region};
}

for (const file of readdirSync(goldens).filter((f) => f.endsWith('.yaml'))) {
  const golden = file.replace(/\.yaml$/, '');
  const fixture = ALIAS[golden] ?? golden;
  const region = golden in ALIAS ? undefined : REGION[fixture];
  const result = emitCloudFormation(fixtureInput(fixture, region), {syntax: 'json'});
  if (!result.ok) throw new Error(`${golden}: ${result.reason}`);
  writeFileSync(join(outDir, `${golden}.json`), result.code);
}
console.log(`rendered JSON for ${readdirSync(outDir).length} goldens into ${outDir}`);
