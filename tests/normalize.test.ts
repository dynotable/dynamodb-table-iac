import {describe, expect, it} from 'vitest';
import {normalize, referencedAttributes} from '../src/normalize';
import type {TableSpec} from '../src/normalize';
import {fixtureInput, fixtureTable} from './helpers/fixtures';

// Every expectation below is stated from the fixture's own JSON (see
// tests/fixtures/PROVENANCE.md) and the rules in the plan — never computed by
// calling normalize() a second time.

function spec(name: string, overrides: Parameters<typeof fixtureInput>[1] = {}): TableSpec {
  const result = normalize(fixtureInput(name, overrides));
  if (!result.ok) throw new Error(`expected ok for ${name}, got: ${result.reason}`);
  return result.spec;
}

function reason(name: string, overrides: Parameters<typeof fixtureInput>[1] = {}): string {
  const result = normalize(fixtureInput(name, overrides));
  if (result.ok) throw new Error(`expected a refusal for ${name}`);
  return result.reason;
}

describe('normalize — Local captures', () => {
  it('a-core: on-demand, two GSIs, TTL enabled, deletion protection', () => {
    const s = spec('a-core', {region: 'us-east-1'});
    expect(s.tableName).toBe('iacfx-a-core');
    expect(s.homeRegion).toBe('us-east-1');
    expect(s.keySchema).toEqual([
      {name: 'pk', type: 'HASH'},
      {name: 'sk', type: 'RANGE'}
    ]);
    expect(s.billing).toEqual({mode: 'PAY_PER_REQUEST', max: {}});
    expect(s.gsis.map((g) => g.name)).toEqual(['gsi1', 'by-status']);
    expect(s.gsis[1]?.projection).toEqual({type: 'INCLUDE', nonKeyAttributes: ['total', 'customerId']});
    expect(s.gsis[0]?.throughput).toBeUndefined();
    expect(s.ttl).toEqual({kind: 'enabled', attribute: 'expiresAt'});
    expect(s.deletionProtection).toBe(true);
    expect(s.stream).toBeUndefined();
    expect(s.replicas).toEqual([]);
    expect(s.consistency).toBe('EVENTUAL');
  });

  it('b-provisioned: PROVISIONED without a BillingModeSummary, per-GSI capacity, LSI', () => {
    const s = spec('b-provisioned', {region: 'us-east-1'});
    expect(s.billing).toEqual({mode: 'PROVISIONED', throughput: {read: 5, write: 10}});
    expect(s.gsis).toEqual([
      {
        name: 'by-email',
        keySchema: [{name: 'email', type: 'HASH'}],
        projection: {type: 'KEYS_ONLY', nonKeyAttributes: []},
        throughput: {read: 2, write: 3}
      }
    ]);
    expect(s.lsis).toEqual([
      {
        name: 'by-score',
        keySchema: [
          {name: 'pk', type: 'HASH'},
          {name: 'score', type: 'RANGE'}
        ],
        projection: {type: 'ALL', nonKeyAttributes: []}
      }
    ]);
    expect(s.ttl).toEqual({kind: 'disabled'});
  });

  it('b-provisioned (i): the ddblocal ARN falls back to the given region and is never a mismatch', () => {
    expect(spec('b-provisioned', {region: 'eu-central-1'}).homeRegion).toBe('eu-central-1');
    expect(spec('b-provisioned').homeRegion).toBeUndefined();
  });

  it('c-stream: the stream view type is carried', () => {
    expect(spec('c-stream', {region: 'us-east-1'}).stream).toBe('NEW_AND_OLD_IMAGES');
  });
});

describe('normalize — authored AWS shapes', () => {
  it('c-extras-aws: SSE KMS without a key, table class, on-demand read max only', () => {
    const s = spec('c-extras-aws');
    expect(s.homeRegion).toBe('eu-west-1');
    expect(s.sse).toEqual({kind: 'kms', liveKeyArn: 'arn:aws:kms:eu-west-1:123456789012:key/1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b'});
    expect(s.tableClass).toBe('STANDARD_INFREQUENT_ACCESS');
    expect(s.billing).toEqual({mode: 'PAY_PER_REQUEST', max: {maxRead: 2000}});
    expect(s.notes.some((n) => n.includes('kms') && n.includes('1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b'))).toBe(true);
  });

  it('d-vector: the complete index is carried, the mid-create one is dropped with a note', () => {
    const s = spec('d-vector');
    expect(s.vectorIndexes).toEqual([
      {
        name: 'by-embedding',
        attribute: 'embedding',
        dimensions: 1024,
        distanceFunction: 'COSINE',
        projection: {type: 'ALL', nonKeyAttributes: []},
        searchSchema: [
          {name: 'tenant', type: 'HASH'},
          {name: 'category', type: 'INLINE_FILTER'}
        ]
      }
    ]);
    expect(s.notes).toContain('Vector index "by-title-embedding" is still being created (its definition is incomplete) and was left out.');
  });

  it('e-multikey-gsi: two HASH + two RANGE keys survive in order', () => {
    const s = spec('e-multikey-gsi');
    expect(s.gsis[0]?.keySchema).toEqual([
      {name: 'tenant', type: 'HASH'},
      {name: 'kind', type: 'HASH'},
      {name: 'ts', type: 'RANGE'},
      {name: 'actor', type: 'RANGE'}
    ]);
  });

  it('f-hostile: hostile attribute names pass through unchanged (escaping is the emitter\'s job)', () => {
    const s = spec('f-hostile');
    expect(s.tableName).toBe('yes');
    expect(s.keySchema.map((k) => k.name)).toEqual(['pk"quote', 'sk${interp}']);
    expect(s.gsis[0]?.projection.nonKeyAttributes).toContain('"}); new CfnOutput(this,"x",{value:"y"}); ({"');
    expect(s.attributeTypes.get('__proto__')).toBeUndefined();
    expect(s.attributeTypes.has('new\nline')).toBe(true);
  });
});

describe('normalize — global tables', () => {
  it('h1: keeps UPDATING, drops DELETING and other-account replicas, carries overrides', () => {
    const s = spec('h1-eventual-ondemand');
    expect(s.homeRegion).toBe('us-east-1');
    expect(s.replicas.map((r) => [r.region, r.status])).toEqual([
      ['eu-west-1', 'ACTIVE'],
      ['ap-northeast-1', 'UPDATING']
    ]);
    expect(s.replicas[0]).toEqual({
      region: 'eu-west-1',
      status: 'ACTIVE',
      tableClass: 'STANDARD_INFREQUENT_ACCESS',
      maxRead: 500,
      gsiOverrides: [{name: 'by-user', maxRead: 100}]
    });
    expect(s.notes).toEqual(
      expect.arrayContaining([
        'Replica in ap-northeast-1 is "UPDATING" (kept: leaving a live replica out would make an apply delete it).',
        'Replica in sa-east-1 is DELETING and was left out.',
        'Replica in eu-central-1 belongs to account "999999999999" and was left out — manage it from that account.'
      ])
    );
    expect(s.gsis[0]?.max).toEqual({});
  });

  it('h2: provisioned replica read override and GSI read override', () => {
    const s = spec('h2-eventual-provisioned');
    expect(s.billing).toEqual({mode: 'PROVISIONED', throughput: {read: 20, write: 10}});
    expect(s.deletionProtection).toBe(true);
    expect(s.replicas).toEqual([
      {region: 'eu-west-1', status: 'ACTIVE', readCapacity: 7, gsiOverrides: [{name: 'by-account', readCapacity: 3}]}
    ]);
  });

  it('h3: STRONG across continents is a valid spec (the CDK emitter alone refuses it)', () => {
    const s = spec('h3-strong-cross-continent');
    expect(s.consistency).toBe('STRONG');
    expect(s.replicas.map((r) => r.region)).toEqual(['eu-west-1', 'ap-northeast-1']);
    expect(s.witnesses).toEqual([]);
  });

  it('h4: STRONG with a witness', () => {
    const s = spec('h4-strong-witness');
    expect(s.replicas.map((r) => r.region)).toEqual(['us-east-2']);
    expect(s.witnesses).toEqual(['us-west-2']);
  });

  it('a replica naming the home region is dropped as a duplicate, not refused', () => {
    const table = fixtureTable('h4-strong-witness');
    table.Replicas = [...(table.Replicas ?? []), {RegionName: 'us-east-1', ReplicaStatus: 'ACTIVE'}];
    const result = normalize({table});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.replicas.map((r) => r.region)).toEqual(['us-east-2']);
  });

  it('an empty Replicas array is a single-region table', () => {
    const table = fixtureTable('a-core');
    table.Replicas = [];
    const result = normalize({table, region: 'us-east-1'});
    expect(result.ok && result.spec.replicas).toEqual([]);
  });
});

describe('normalize — TTL states', () => {
  it('undefined is "not provided", null is "unknown", each with its own header note', () => {
    const notProvided = spec('c-stream', {region: 'us-east-1', timeToLive: undefined});
    expect(notProvided.ttl).toEqual({kind: 'not-provided'});
    expect(notProvided.notes).toContain('TTL: not provided — include the output of `aws dynamodb describe-time-to-live` to add it.');
    const unknown = spec('c-stream', {region: 'us-east-1', timeToLive: null});
    expect(unknown.ttl).toEqual({kind: 'unknown'});
    expect(unknown.notes).toContain('TTL: unknown — DescribeTimeToLive failed, so no TTL setting is emitted.');
  });
});

describe('normalize — refusals', () => {
  it.each([
    ['g-real-arn', {region: 'us-east-1'}, /ARN is in eu-west-1 but the region given is us-east-1/],
    ['g-replicas-without-region', {}, /Cannot identify the table's own region/],
    ['g-strong-with-deleting', {}, /us-west-2 is DELETING on a strongly consistent global table/],
    ['g-no-summary-rcu0', {}, /Cannot determine the billing mode/],
    ['g-provisioned-without-throughput', {}, /PROVISIONED but has no positive ReadCapacityUnits\/WriteCapacityUnits/],
    ['g-invalid-table-name', {}, /"bad name!" is not a valid DynamoDB name/],
    ['g-key-without-definition', {}, /key attribute "sk" has no entry in AttributeDefinitions/],
    ['g-conflicting-definitions', {}, /"pk" is declared twice with different types \(S and N\)/],
    ['g-range-first', {}, /lists a RANGE key before a HASH key/],
    ['g-lsi-foreign-hash', {}, /must share the table's HASH key "pk"/],
    ['g-stream-without-view-type', {}, /stream is enabled but StreamViewType is missing/]
  ] as const)('%s → %s', (name, overrides, pattern) => {
    expect(reason(name, overrides)).toMatch(pattern);
  });

  it('accepts the 4-letter sovereign-cloud region prefix', () => {
    const table = fixtureTable('a-core');
    expect(normalize({table, region: 'eusc-de-east-1'}).ok).toBe(true);
  });

  it('refuses a non-region string given as the region', () => {
    const table = fixtureTable('a-core');
    expect(reason('a-core', {region: 'ddblocal'})).toMatch(/"ddblocal" is not an AWS region name/);
    expect(normalize({table, region: 'US-EAST-1'}).ok).toBe(false);
  });
});

describe('referencedAttributes', () => {
  it('lists exactly the key attributes, in first-appearance order', () => {
    // From b-provisioned's JSON: table keys pk, sk; GSI by-email on email; LSI by-score on pk + score.
    expect(referencedAttributes(spec('b-provisioned', {region: 'us-east-1'}), {vectorIndexes: false})).toEqual([
      {name: 'pk', type: 'S'},
      {name: 'sk', type: 'S'},
      {name: 'email', type: 'S'},
      {name: 'score', type: 'N'}
    ]);
  });

  it('adds vector search-schema attributes only when the target emits vector indexes', () => {
    const s = spec('d-vector');
    // d-vector declares pk, sk, tenant, category; `embedding` itself has no declared type.
    expect(referencedAttributes(s, {vectorIndexes: false}).map((a) => a.name)).toEqual(['pk', 'sk']);
    expect(referencedAttributes(s, {vectorIndexes: true}).map((a) => a.name)).toEqual(['pk', 'sk', 'tenant', 'category']);
  });

  it('never lists a declared attribute nothing references', () => {
    // a-core declares gsi1pk/createdAt/status which its GSIs reference — but drop the GSIs and they must vanish.
    const table = fixtureTable('a-core');
    table.GlobalSecondaryIndexes = [];
    const result = normalize({table, region: 'us-east-1'});
    if (!result.ok) throw new Error(result.reason);
    expect(referencedAttributes(result.spec, {vectorIndexes: true}).map((a) => a.name)).toEqual(['pk', 'sk']);
  });
});
