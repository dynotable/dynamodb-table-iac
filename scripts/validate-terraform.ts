// Real-tool validation of the Terraform goldens: every golden is planned with
// the hashicorp/aws provider at ONE exact version against a local stub that
// answers DescribeTable with ResourceNotFoundException, and the planned values
// are compared with an expectation derived independently from the raw fixture
// (tests/tools/compare.ts). `terraform plan` alone checks none of the facts we
// care about — attribute set, replica set, stream, consistency — it only
// proves the file is a valid table (measured), hence the comparator.
//
//   node scripts/validate-terraform.ts --provider 6.66.0 [--port 8799] [--keep]
//
// Needs `terraform` on PATH. Honours TF_PLUGIN_CACHE_DIR (defaults to
// .validate-work/plugin-cache so the ~700 MB provider downloads once).
import {execFileSync, spawn} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import type {GoldenRecord} from '../tests/helpers/goldens.ts';
import {
  deriveHome,
  projectTerraformValues,
  stableJson,
  terraformExpectation,
  type RawTable,
  type RawTtl,
  type TerraformExpectation
} from '../tests/tools/compare.ts';

const ROOT = resolve(import.meta.dirname, '..');
const GOLDENS = join(ROOT, 'tests', 'golden', 'terraform');
const FIXTURES = join(ROOT, 'tests', 'fixtures');
/** A region no fixture uses as home: a golden that wrongly drops its provider block can never pass. */
const DUMMY_REGION = 'ap-southeast-4';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] !== undefined) return process.argv[i + 1] as string;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

const provider = arg('provider');
const port = Number(arg('port', '8799'));
const keep = process.argv.includes('--keep');
const work = join(ROOT, '.validate-work', 'terraform', provider);
const pluginCache = process.env.TF_PLUGIN_CACHE_DIR ?? join(ROOT, '.validate-work', 'plugin-cache');
mkdirSync(pluginCache, {recursive: true});
const env = {...process.env, TF_PLUGIN_CACHE_DIR: pluginCache, TF_IN_AUTOMATION: '1'};

const records = JSON.parse(readFileSync(join(FIXTURES, 'goldens.json'), 'utf8')) as Record<string, GoldenRecord>;

function tf(cwd: string, args: string[]): string {
  return execFileSync('terraform', [...args, '-no-color'], {cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
}

/** The `describe-time-to-live` sidecar, when the fixture has one. */
function readTtl(fixture: string): RawTtl {
  try {
    return (JSON.parse(readFileSync(join(FIXTURES, `${fixture}.ttl.json`), 'utf8')) as {TimeToLiveDescription: RawTtl}).TimeToLiveDescription;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
}

function overrideFile(regionless: boolean): string {
  const region = regionless ? `  region                      = "${DUMMY_REGION}"\n` : '';
  return `provider "aws" {
${region}  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  endpoints {
    dynamodb = "http://127.0.0.1:${port}"
  }
}

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= ${provider}"
    }
  }
}
`;
}

async function startStub(): Promise<() => void> {
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'ddb-stub.ts'), String(port)], {stdio: ['ignore', 'pipe', 'inherit']});
  await new Promise<void>((resolveReady, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes(`listening ${port}`)) resolveReady();
    });
    child.on('exit', (code) => reject(new Error(`stub exited with ${code}`)));
  });
  return () => child.kill();
}

type Plan = {
  planned_values: {root_module: {resources: Array<{type: string; values: Record<string, unknown>}>}};
  resource_changes: Array<{change: {actions: string[]}}>;
  configuration: {provider_config?: {aws?: {expressions?: {region?: {constant_value?: string}}}}};
};

function validateGolden(name: string, record: GoldenRecord): string[] {
  const failures: string[] = [];
  const goldenText = readFileSync(join(GOLDENS, `${name}.tf`), 'utf8');
  const table = (JSON.parse(readFileSync(join(FIXTURES, `${record.fixture}.describe.json`), 'utf8')) as {Table: RawTable}).Table;
  const expectation: TerraformExpectation = terraformExpectation(table, record.region, readTtl(record.fixture));
  const home = deriveHome(table, record.region);

  // The golden declares a provider region IFF the raw fixture has a home region.
  const declaresRegion = /^provider "aws" \{\n  region = "([^"]+)"\n\}/m.exec(goldenText)?.[1];
  if ((declaresRegion !== undefined) !== (home !== undefined) || (home !== undefined && declaresRegion !== home)) {
    failures.push(`provider region: golden declares ${JSON.stringify(declaresRegion)}, raw fixture home is ${JSON.stringify(home)}`);
  }

  const dir = join(work, name);
  rmSync(dir, {recursive: true, force: true});
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, 'main.tf'), goldenText);
  writeFileSync(join(dir, 'z_override.tf'), overrideFile(home === undefined));

  tf(dir, ['init', '-backend=false', '-input=false']);
  const selected = (JSON.parse(tf(dir, ['version', '-json'])) as {provider_selections: Record<string, string>})
    .provider_selections['registry.terraform.io/hashicorp/aws'];
  if (selected !== provider) failures.push(`provider selection: wanted ${provider}, terraform picked ${selected}`);

  tf(dir, ['plan', '-out=plan.bin', '-input=false', '-lock=false']);
  const plan = JSON.parse(tf(dir, ['show', '-json', 'plan.bin'])) as Plan;

  const resources = plan.planned_values.root_module.resources;
  if (resources.length !== 1 || resources[0]?.type !== 'aws_dynamodb_table') {
    failures.push(`planned resources: ${resources.map((r) => r.type).join(', ') || 'none'}`);
  }
  if (plan.resource_changes.length !== 1 || plan.resource_changes[0]?.change.actions.join() !== 'create') {
    failures.push(`actions: ${JSON.stringify(plan.resource_changes.map((c) => c.change.actions))}`);
  }
  const values = resources[0]?.values ?? {};
  const actual = projectTerraformValues(values, expectation);
  if (stableJson(actual) !== stableJson(expectation.values)) {
    failures.push(`planned values differ from the raw fixture\n--- expected\n${stableJson(expectation.values)}\n--- planned\n${stableJson(actual)}`);
  }
  // The effective provider region is the golden's own, or the override's dummy for a region-less golden.
  const configuredRegion = plan.configuration.provider_config?.aws?.expressions?.region?.constant_value;
  const effectiveRegion = (values as {region?: string}).region ?? configuredRegion;
  if (effectiveRegion !== (home ?? DUMMY_REGION)) {
    failures.push(`effective provider region ${JSON.stringify(effectiveRegion)}, expected ${JSON.stringify(home ?? DUMMY_REGION)}`);
  }
  // No replica may name the raw home region.
  const replicaRegions = ((values.replica as Array<{region_name: string}> | undefined) ?? []).map((r) => r.region_name);
  if (home !== undefined && replicaRegions.includes(home)) failures.push(`replica names the home region ${home}`);

  if (!keep && failures.length === 0) rmSync(dir, {recursive: true, force: true});
  return failures;
}

const stop = await startStub();
let failed = 0;
try {
  const fmt = spawnSyncStatus(['fmt', '-check', '-diff', GOLDENS]);
  if (fmt !== '') {
    failed++;
    console.error(`terraform fmt -check:\n${fmt}`);
  }
  for (const file of readdirSync(GOLDENS).filter((f) => f.endsWith('.tf')).sort()) {
    const name = file.slice(0, -3);
    const record = records[name];
    if (record === undefined) throw new Error(`${name}: not in tests/fixtures/goldens.json`);
    let failures: string[];
    try {
      failures = validateGolden(name, record);
    } catch (error) {
      failures = [error instanceof Error ? `${error.message}\n${(error as {stderr?: string}).stderr ?? ''}` : String(error)];
    }
    if (failures.length === 0) console.log(`${name}: ok (aws ${provider})`);
    else {
      failed++;
      console.error(`${name}: FAIL\n  ${failures.join('\n  ')}`);
    }
  }
} finally {
  stop();
}
if (!keep && failed === 0 && existsSync(work)) rmSync(work, {recursive: true, force: true});
process.exit(failed === 0 ? 0 : 1);

function spawnSyncStatus(args: string[]): string {
  try {
    execFileSync('terraform', [...args, '-no-color'], {cwd: ROOT, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    return '';
  } catch (error) {
    const e = error as {stdout?: string; stderr?: string; message: string};
    return `${e.stdout ?? ''}${e.stderr ?? ''}` || e.message;
  }
}
