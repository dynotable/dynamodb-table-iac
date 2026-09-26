// Real-tool validation of the CDK goldens: compile them with `tsc` against the
// aws-cdk-lib pinned in validate/cdk/package.json, synthesize each stack, and
// require the ONE `AWS::DynamoDB::GlobalTable` it produces to equal the
// CloudFormation golden for the same fixture under the measured canonical form
// in tests/tools/compare.ts. The two D2 divergences are allowed only when the
// CDK file's header states them.
//
//   pnpm --dir validate/cdk install
//   node scripts/validate-cdk.ts [--keep]
//
// No `cdk` CLI: an `App` synthesizes itself when CDK_OUTDIR is set (that is
// what the CLI does too), so a plain `node` run writes the cloud assembly.
//
// Two synth WARNINGS are expected and not failures (measured 2026-09-26):
// `VectorIndexes: Additional properties are not allowed` — the bundled L1
// schema (service-spec 0.1.211) predates vector indexes, which is the whole
// reason the golden uses addPropertyOverride; and E1029 on the hostile-names
// golden, where an attribute named `sk${interp}` is a literal outside Fn::Sub.
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {parse as parseYaml} from 'yaml';
import {applyCdkDivergences, canonicalGlobalTableProperties, stableJson} from '../tests/tools/compare.ts';

const ROOT = resolve(import.meta.dirname, '..');
const CDK_GOLDENS = join(ROOT, 'tests', 'golden', 'cdk');
const CFN_GOLDENS = join(ROOT, 'tests', 'golden', 'cloudformation');
const VALIDATE = join(ROOT, 'validate', 'cdk');
const SRC = join(VALIDATE, 'src');
const OUT = join(VALIDATE, 'out');
const keep = process.argv.includes('--keep');

type Props = {[key: string]: unknown};
type Resource = {Type: string; Properties: Props; DeletionPolicy?: string; UpdateReplacePolicy?: string};
type Template = {Resources: Record<string, Resource>};

const libPackage = join(VALIDATE, 'node_modules', 'aws-cdk-lib', 'package.json');
if (!existsSync(libPackage)) throw new Error('aws-cdk-lib is not installed: run `pnpm --dir validate/cdk install` first');
const declared = (JSON.parse(readFileSync(join(VALIDATE, 'package.json'), 'utf8')) as {devDependencies: Record<string, string>})
  .devDependencies['aws-cdk-lib'];
const installed = (JSON.parse(readFileSync(libPackage, 'utf8')) as {version: string}).version;
console.log(`aws-cdk-lib ${installed} (validate/cdk/package.json pins ${declared})`);

// The goldens import aws-cdk-lib, which lives under validate/cdk, so they are
// compiled from a copy inside it — tsc resolves modules from the importing file.
rmSync(SRC, {recursive: true, force: true});
rmSync(OUT, {recursive: true, force: true});
mkdirSync(SRC, {recursive: true});
const names = readdirSync(CDK_GOLDENS)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.slice(0, -3))
  .sort();
for (const name of names) copyFileSync(join(CDK_GOLDENS, `${name}.ts`), join(SRC, `${name}.ts`));

execFileSync(join(VALIDATE, 'node_modules', '.bin', 'tsc'), ['-p', join(VALIDATE, 'tsconfig.json')], {stdio: 'inherit'});
console.log(`tsc: ${names.length} goldens compile (strict, noUnusedLocals)`);

let failed = 0;
for (const name of names) {
  const failures: string[] = [];
  const outdir = join(OUT, 'cdk', name);
  execFileSync(process.execPath, [join(OUT, `${name}.js`)], {env: {...process.env, CDK_OUTDIR: outdir}, stdio: ['ignore', 'ignore', 'inherit']});
  const templates = readdirSync(outdir).filter((f) => f.endsWith('.template.json'));
  if (templates.length !== 1) failures.push(`expected one stack template, found ${templates.join(', ') || 'none'}`);
  const template = JSON.parse(readFileSync(join(outdir, templates[0] as string), 'utf8')) as Template;
  const globalTables = Object.values(template.Resources).filter((r) => r.Type === 'AWS::DynamoDB::GlobalTable');
  if (globalTables.length !== 1) {
    failures.push(`expected exactly one AWS::DynamoDB::GlobalTable, found ${globalTables.length} of ${Object.keys(template.Resources).length} resources`);
  }
  const cdkResource = globalTables[0];
  const cfnTemplate = parseYaml(readFileSync(join(CFN_GOLDENS, `${name}.yaml`), 'utf8')) as Template;
  const cfnResource = Object.values(cfnTemplate.Resources)[0];
  if (cdkResource !== undefined && cfnResource !== undefined) {
    if (cdkResource.DeletionPolicy !== 'Retain' || cdkResource.UpdateReplacePolicy !== 'Retain') {
      failures.push(`policies: ${cdkResource.DeletionPolicy}/${cdkResource.UpdateReplacePolicy}, expected Retain/Retain`);
    }
    const {cdk, divergences} = applyCdkDivergences(cdkResource.Properties, cfnResource.Properties);
    const header = readFileSync(join(CDK_GOLDENS, `${name}.ts`), 'utf8');
    for (const d of divergences) {
      const stated = header.includes(d.headerSentence);
      if (d.applied && !stated) failures.push(`divergence applied but not stated in the header: ${d.headerSentence}`);
      if (!d.applied && stated) failures.push(`header states a divergence that did not occur: ${d.headerSentence}`);
    }
    const left = stableJson(canonicalGlobalTableProperties(cdk));
    const right = stableJson(canonicalGlobalTableProperties(cfnResource.Properties));
    if (left !== right) failures.push(`Properties differ from the CloudFormation golden\n--- cdk synth (canonical)\n${left}\n--- cloudformation golden (canonical)\n${right}`);
  }
  if (failures.length === 0) console.log(`${name}: ok`);
  else {
    failed++;
    console.error(`${name}: FAIL\n  ${failures.join('\n  ')}`);
  }
}
if (!keep && failed === 0) {
  rmSync(SRC, {recursive: true, force: true});
  rmSync(OUT, {recursive: true, force: true});
}
process.exit(failed === 0 ? 0 : 1);
