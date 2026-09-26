import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {emitTerraform} from '../src/emit/terraform';
import {fixtureInput} from './helpers/fixtures';

// Goldens are hand-written from the hashicorp/aws v6.66 `aws_dynamodb_table`
// docs and kept `terraform fmt`-clean (CI runs fmt -check over them); the
// emitter is made to match the golden, never the other way round.
const GOLDEN = join(import.meta.dirname, 'golden', 'terraform');

function golden(name: string): string {
  return readFileSync(join(GOLDEN, `${name}.tf`), 'utf8');
}

function code(name: string, overrides: Parameters<typeof fixtureInput>[1] = {}): string {
  const result = emitTerraform(fixtureInput(name, overrides));
  if (!result.ok) throw new Error(`expected ok for ${name}, got: ${result.reason}`);
  return result.code;
}

describe('emitTerraform — goldens', () => {
  it.each([
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
    ['h3-strong-cross-continent', {}],
    ['h4-strong-witness', {}]
  ] as const)('%s', (name, overrides) => {
    expect(code(name, overrides)).toBe(golden(name));
  });

  it('i-regionless: b-provisioned without a region declares no provider region', () => {
    expect(code('b-provisioned')).toBe(golden('i-regionless'));
  });
});

describe('emitTerraform — invariants stated from the fixtures', () => {
  it('defines no vector-only attribute (the provider rejects an attribute no key uses)', () => {
    // d-vector declares tenant/category for the vector search schema and pk/sk for the keys.
    const out = code('d-vector');
    expect(out).not.toMatch(/name = "tenant"/);
    expect(out).not.toMatch(/name = "category"/);
    expect(out).not.toMatch(/name = "embedding"/);
    expect(out.match(/^\s+attribute \{/gm)).toHaveLength(2);
  });

  it('forces a NEW_AND_OLD_IMAGES stream on an EVENTUAL global table but not on a STRONG one', () => {
    expect(code('h1-eventual-ondemand')).toMatch(/stream_view_type\s+= "NEW_AND_OLD_IMAGES"/);
    expect(code('h3-strong-cross-continent')).not.toMatch(/stream_enabled/);
  });

  it('never names the home region in a replica block', () => {
    for (const name of ['h1-eventual-ondemand', 'h2-eventual-provisioned', 'h3-strong-cross-continent', 'h4-strong-witness']) {
      expect(code(name)).not.toMatch(/region_name\s+= "us-east-1"/);
    }
  });

  it('leaves no raw interpolation opener or line terminator anywhere in the hostile output', () => {
    const out = code('f-hostile');
    expect(out).not.toMatch(/[^$]\$\{/);
    expect(out).not.toMatch(/[^%]%\{/);
    expect(out).not.toMatch(/[\u2028\u2029\u0085]/);
    // The valid-code payload is inside a string literal, not a new resource.
    expect(out.match(/^resource /gm)).toHaveLength(1);
  });
});

describe('emitTerraform — refusals pass through from normalize()', () => {
  it.each([
    ['g-real-arn', {region: 'us-east-1'}, /ARN is in eu-west-1/],
    ['g-strong-with-deleting', {}, /DELETING on a strongly consistent global table/],
    ['g-key-without-definition', {}, /no entry in AttributeDefinitions/]
  ] as const)('%s', (name, overrides, pattern) => {
    const result = emitTerraform(fixtureInput(name, overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(pattern);
  });
});
