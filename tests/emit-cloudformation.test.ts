import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parse as parseYaml} from 'yaml';
import {describe, expect, it} from 'vitest';
import {emitCloudFormation} from '../src/emit/cloudformation';
import {fixtureInput, fixtureTable} from './helpers/fixtures';
import {GOLDEN_NAMES, goldenInput} from './helpers/goldens';

// YAML goldens are hand-written from the AWS::DynamoDB::GlobalTable schema
// (aws-dynamodb-globaltable.json, fetched 2026-09-26); the emitter is made to
// match them. Only ONE JSON golden exists — the JSON form is JSON.stringify of
// the same tree, which the YAML↔JSON parity test proves for every fixture.
const GOLDEN = join(import.meta.dirname, 'golden', 'cloudformation');


function golden(name: string, ext: 'yaml' | 'json'): string {
  return readFileSync(join(GOLDEN, `${name}.${ext}`), 'utf8');
}

function emit(name: string, syntax: 'yaml' | 'json'): string {
  const result = emitCloudFormation(goldenInput(name), {syntax});
  if (!result.ok) throw new Error(`expected ok for ${name}, got: ${result.reason}`);
  return result.code;
}

type Template = {
  Description: string;
  Resources: Record<string, {Type: string; DeletionPolicy: string; UpdateReplacePolicy: string; Properties: Record<string, unknown>}>;
};

function template(name: string): Template {
  return JSON.parse(emit(name, 'json')) as Template;
}

describe('emitCloudFormation — goldens', () => {
  it.each(GOLDEN_NAMES)('%s (yaml)', (name) => {
    expect(emit(name, 'yaml')).toBe(golden(name, 'yaml'));
  });

  it('a-core (json)', () => {
    expect(emit('a-core', 'json')).toBe(golden('a-core', 'json'));
  });
});

describe('emitCloudFormation — YAML and JSON are the same document', () => {
  it.each(GOLDEN_NAMES)('%s', (name) => {
    expect(parseYaml(emit(name, 'yaml'))).toEqual(JSON.parse(emit(name, 'json')));
  });
});

// Independent comparator: cfn-lint checks almost none of these on GlobalTable
// (measured 2026-09-26 — an unused attribute, missing stream, missing stack
// region and missing replica read settings all lint clean), so the invariants
// are asserted here from expectations written by hand off the raw fixtures.
describe('emitCloudFormation — invariants stated from the fixtures', () => {
  it.each([
    ['a-core', ['pk', 'sk', 'gsi1pk', 'createdAt', 'status']],
    ['b-provisioned', ['pk', 'sk', 'email', 'score']],
    ['b-hash-only', ['id']],
    ['c-stream', ['pk']],
    ['c-extras-aws', ['pk']],
    ['d-vector', ['pk', 'sk', 'tenant', 'category']],
    ['e-multikey-gsi', ['pk', 'sk', 'tenant', 'kind', 'ts', 'actor']],
    ['f-hostile', ['pk"quote', 'sk${interp}', '%{directive}', 'back\\slash', 'new\nline']],
    ['h1-eventual-ondemand', ['pk', 'sk', 'userId']],
    ['h2-eventual-provisioned', ['pk', 'sk', 'account']],
    ['h3-strong-cross-continent', ['pk', 'sk']],
    ['h4-strong-witness', ['pk']],
    ['i-regionless', ['pk', 'sk', 'email', 'score']]
  ] as const)('%s declares exactly the key (and search-schema) attributes', (name, expected) => {
    const props = Object.values(template(name).Resources)[0]?.Properties as {
      AttributeDefinitions: Array<{AttributeName: string}>;
    };
    expect(props.AttributeDefinitions.map((a) => a.AttributeName).sort()).toEqual([...expected].sort());
  });

  // Home first, then every raw replica that is neither DELETING nor in another
  // account (h1 drops sa-east-1 and eu-central-1 for those two reasons); a
  // region-less golden's sole replica is the stack's own region.
  it.each([
    ['a-core', ['us-east-1']],
    ['b-provisioned', ['us-east-1']],
    ['b-hash-only', ['us-east-1']],
    ['c-stream', ['us-east-1']],
    ['c-extras-aws', ['eu-west-1']],
    ['d-vector', ['us-east-1']],
    ['e-multikey-gsi', ['us-east-1']],
    ['f-hostile', ['us-east-1']],
    ['h1-eventual-ondemand', ['us-east-1', 'eu-west-1', 'ap-northeast-1']],
    ['h2-eventual-provisioned', ['us-east-1', 'eu-west-1']],
    ['h3-strong-cross-continent', ['us-east-1', 'eu-west-1', 'ap-northeast-1']],
    ['h4-strong-witness', ['us-east-1', 'us-east-2']],
    ['i-regionless', [{Ref: 'AWS::Region'}]]
  ] as const)('%s lists the home region first, then every kept replica', (name, expected) => {
    const props = Object.values(template(name).Resources)[0]?.Properties as {
      Replicas: Array<{Region: unknown}>;
    };
    expect(props.Replicas.map((r) => r.Region)).toEqual(expected);
  });

  // Only a-core and h2 carry DeletionProtectionEnabled in their raw fixtures.
  it.each(GOLDEN_NAMES)('%s puts DeletionProtectionEnabled on the home replica only', (name) => {
    const props = Object.values(template(name).Resources)[0]?.Properties as {
      Replicas: Array<{DeletionProtectionEnabled?: boolean}>;
    };
    const protectedHome = name === 'a-core' || name === 'h2-eventual-provisioned';
    expect(props.Replicas.map((r) => r.DeletionProtectionEnabled)).toEqual([
      protectedHome ? true : undefined,
      ...props.Replicas.slice(1).map(() => undefined)
    ]);
  });

  it('matches the raw fixture on consistency and witnesses', () => {
    const strong = Object.values(template('h4-strong-witness').Resources)[0]?.Properties as Record<string, unknown>;
    expect(strong.MultiRegionConsistency).toBe('STRONG');
    expect(strong.GlobalTableWitnesses).toEqual([{Region: 'us-west-2'}]);
    const eventual = Object.values(template('h1-eventual-ondemand').Resources)[0]?.Properties as Record<string, unknown>;
    expect(eventual.MultiRegionConsistency).toBeUndefined();
    expect(eventual.GlobalTableWitnesses).toBeUndefined();
  });

  it('streams NEW_AND_OLD_IMAGES on an EVENTUAL table with more than one replica, never on a STRONG one', () => {
    const eventual = Object.values(template('h2-eventual-provisioned').Resources)[0]?.Properties as Record<string, unknown>;
    expect(eventual.StreamSpecification).toEqual({StreamViewType: 'NEW_AND_OLD_IMAGES'});
    const strong = Object.values(template('h3-strong-cross-continent').Resources)[0]?.Properties as Record<string, unknown>;
    expect(strong.StreamSpecification).toBeUndefined();
  });

  it('keeps the Description under CloudFormation\'s 1024-byte limit and the resource retained on delete', () => {
    for (const name of GOLDEN_NAMES) {
      const t = template(name);
      expect(Buffer.byteLength(t.Description, 'utf8')).toBeLessThanOrEqual(1024);
      const resource = Object.values(t.Resources)[0];
      expect(resource?.Type).toBe('AWS::DynamoDB::GlobalTable');
      expect(resource?.DeletionPolicy).toBe('Retain');
      expect(resource?.UpdateReplacePolicy).toBe('Retain');
    }
  });

  it('a stream on a single-region table is kept as the live view type', () => {
    const props = Object.values(template('c-stream').Resources)[0]?.Properties as Record<string, unknown>;
    expect(props.StreamSpecification).toEqual({StreamViewType: 'NEW_AND_OLD_IMAGES'});
  });

  it('never leaves a raw line terminator or YAML 1.1 break character in the hostile output', () => {
    const out = emit('f-hostile', 'yaml');
    expect(out).not.toMatch(/[\u2028\u2029\u0085\u009f]/);
    // Exactly one resource, however many payloads tried to open another.
    expect(Object.keys(template('f-hostile').Resources)).toEqual(['Yes']);
  });
});

describe('emitCloudFormation — refusals pass through from normalize()', () => {
  it('refuses a STRONG table with a DELETING member', () => {
    const result = emitCloudFormation(fixtureInput('g-strong-with-deleting'), {syntax: 'yaml'});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/DELETING on a strongly consistent global table/);
  });

  it('refuses replicas with no identifiable home region', () => {
    const table = fixtureTable('g-replicas-without-region');
    const result = emitCloudFormation({table}, {syntax: 'json'});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Cannot identify the table's own region/);
  });
});
