import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {cdkRefusal, emitCdk} from '../src/emit/cdk';
import {normalize} from '../src/normalize';
import type {DescribeTableTable} from '../src/types';
import {fixtureInput, fixtureTable} from './helpers/fixtures';

// Goldens are hand-written from the fixtures against aws-cdk-lib 2.271's
// TableV2 API (source read 2026-09-26); the emitter is made to match them.
// They are real `.ts` files so Task 7 can `tsc` + `cdk synth` them unchanged,
// which is why tsconfig excludes tests/golden.
const GOLDEN = join(import.meta.dirname, 'golden', 'cdk');

const CASES = [
  ['a-core', {region: 'us-east-1'}],
  ['b-provisioned', {region: 'us-east-1'}],
  ['b-hash-only', {region: 'us-east-1'}],
  ['c-stream', {region: 'us-east-1'}],
  ['c-extras-aws', {}],
  ['d-vector', {}],
  ['e-multikey-gsi', {}],
  ['f-hostile', {}],
  ['h1-eventual-ondemand', {}],
  ['h2-eventual-provisioned', {}],
  ['h4-strong-witness', {}]
] as const;

function golden(file: string): string {
  return readFileSync(join(GOLDEN, file), 'utf8');
}

function emit(name: string, overrides: Parameters<typeof fixtureInput>[1] = {}): string {
  const result = emitCdk(fixtureInput(name, overrides));
  if (!result.ok) throw new Error(`expected ok for ${name}, got: ${result.reason}`);
  return result.code;
}

const DDB_IMPORT = /^import \{([^}]+)\} from "aws-cdk-lib\/aws-dynamodb";$/m;
const DDB_NAMES = [
  'AttributeType',
  'Billing',
  'Capacity',
  'MultiRegionConsistency',
  'ProjectionType',
  'StreamViewType',
  'TableClass',
  'TableEncryptionV2',
  'TableV2'
];

/** The non-comment code lines of an emitted file. */
function codeLines(code: string): string {
  return code
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

describe('emitCdk — goldens', () => {
  it.each(CASES)('%s', (name, overrides) => {
    expect(emit(name, overrides)).toBe(golden(`${name}.ts`));
  });

  it('i-regionless: b-provisioned without a region gets a stack with no env', () => {
    expect(emit('b-provisioned')).toBe(golden('i-regionless.ts'));
  });

  it('h3-strong-cross-continent: refused with the recorded reason', () => {
    const result = emitCdk(fixtureInput('h3-strong-cross-continent'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(`${result.reason}\n`).toBe(golden('h3-strong-cross-continent.refusal.txt'));
  });
});

// The goldens must compile against aws-cdk-lib with `noUnusedLocals`, and the
// repo does not install it — so the import list is checked structurally here:
// every imported name is used in code, and every `Name.` used in code is
// imported. Task 7 runs the real `tsc`.
describe('emitCdk — the import list matches the code', () => {
  it.each([...CASES, ['b-provisioned', {}]] as const)('%s', (name, overrides) => {
    const code = emit(name, overrides);
    const match = DDB_IMPORT.exec(code);
    expect(match).not.toBeNull();
    const imported = (match as RegExpExecArray)[1]?.split(', ') ?? [];
    expect(imported).toEqual([...imported].sort());
    const body = codeLines(code.slice((match as RegExpExecArray).index));
    for (const imp of imported) {
      expect(body, `${imp} imported but unused`).toMatch(imp === 'TableV2' ? /new TableV2\(/ : new RegExp(`\\b${imp}\\.`));
    }
    for (const candidate of DDB_NAMES) {
      const used = candidate === 'TableV2' ? /new TableV2\(/.test(body) : new RegExp(`\\b${candidate}\\.`).test(body);
      if (used) expect(imported, `${candidate} used but not imported`).toContain(candidate);
    }
    expect(code.includes('import type {CfnGlobalTable}')).toBe(body.includes('as CfnGlobalTable'));
  });
});

describe('emitCdk — hostile names stay inside their string literals', () => {
  const code = emit('f-hostile');

  it('escapes the two JS line terminators and never emits a second construct', () => {
    // oxlint-disable-next-line no-control-regex -- U+2028/U+2029 are the characters under test
    expect(code).not.toMatch(/[\u2028\u2029]/);
    expect(code.match(/new TableV2\(/g)).toHaveLength(1);
    expect(code.match(/new [A-Za-z]+Stack\(/g)).toHaveLength(1);
    expect(code).not.toContain('new CfnOutput(this,"x"');
  });

  it('writes the code-shaped payloads as escaped strings', () => {
    expect(code).toContain('"\\"}); new CfnOutput(this,\\"x\\",{value:\\"y\\"}); ({\\""');
    expect(code).toContain('"\\nresource \\"terraform_data\\" \\"x\\" {}"');
    expect(code).toContain('{name: "pk\\"quote", type: AttributeType.STRING}');
    expect(code).toContain('"line\\u2028sep"');
  });

  it('writes an index named __proto__ as a computed key, never a prototype assignment', () => {
    const table = structuredClone(fixtureTable('h1-eventual-ondemand')) as DescribeTableTable & {
      GlobalSecondaryIndexes: Array<{IndexName: string}>;
      Replicas: Array<{GlobalSecondaryIndexes?: Array<{IndexName: string}>}>;
    };
    for (const g of table.GlobalSecondaryIndexes) g.IndexName = '__proto__';
    for (const r of table.Replicas) for (const g of r.GlobalSecondaryIndexes ?? []) g.IndexName = '__proto__';
    const result = emitCdk({table});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code).toContain('["__proto__"]: {maxReadRequestUnits: 100}');
      expect(result.code).not.toMatch(/^\s*"?__proto__"?:/m);
    }
  });
});

describe('cdkRefusal — the aws-cdk-lib 2.271 MRSC region-set rule', () => {
  function spec(name: string) {
    const result = normalize(fixtureInput(name));
    if (!result.ok) throw new Error(result.reason);
    return result.spec;
  }

  it('accepts a STRONG table whose home, replica and witness are all in the US set', () => {
    expect(cdkRefusal(spec('h4-strong-witness'))).toBeUndefined();
  });

  it('refuses a witness outside the home region set, naming every region', () => {
    const s = spec('h4-strong-witness');
    const reason = cdkRefusal({...s, witnesses: ['eu-west-1']});
    expect(reason).toMatch(/this table spans us-east-1, us-east-2 and eu-west-1\./);
    expect(reason).toMatch(/Export it as Terraform or CloudFormation instead\.$/);
  });

  it('refuses a STRONG home region CDK knows no set for', () => {
    const s = spec('h4-strong-witness');
    const reason = cdkRefusal({...s, homeRegion: 'ca-central-1'});
    expect(reason).toMatch(/this table spans ca-central-1, us-east-2 and us-west-2\./);
  });

  it('says nothing about an EVENTUAL table spanning continents', () => {
    expect(cdkRefusal(spec('h1-eventual-ondemand'))).toBeUndefined();
  });
});
