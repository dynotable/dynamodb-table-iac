import {quoteForComment} from './escape';
import type {DescribeTableTable, KeySchemaElement, LocalSecondaryIndexDescription, MultiRegionConsistency, ReplicaDescription, ScalarAttributeType, SearchSchemaElementType, StreamViewType, TableClass, TableDefinitionInput, VectorDistanceFunction} from './types';

// The single validation + derivation step. Input is UNTRUSTED (a paste in the
// web tool), so every value that reaches generated code is checked here —
// content AND structure — and anything the emitters cannot represent safely is
// an `{ok: false}` with one English sentence naming the field and the fix.
// Emitters read the resulting TableSpec and may assume it is valid.

export interface KeySpec {
  name: string;
  type: 'HASH' | 'RANGE';
}

export interface ProjectionSpec {
  type: 'ALL' | 'KEYS_ONLY' | 'INCLUDE';
  nonKeyAttributes: string[];
}

export type Throughput = {read: number; write: number};
export type OnDemandMax = {maxRead?: number; maxWrite?: number};

export type BillingSpec =
  | {mode: 'PAY_PER_REQUEST'; max: OnDemandMax}
  | {mode: 'PROVISIONED'; throughput: Throughput};

export interface GsiSpec {
  name: string;
  keySchema: KeySpec[];
  projection: ProjectionSpec;
  /** Present iff the table is PROVISIONED. */
  throughput?: Throughput;
  /** Present iff the table is PAY_PER_REQUEST. */
  max?: OnDemandMax;
}

export interface LsiSpec {
  name: string;
  keySchema: KeySpec[];
  projection: ProjectionSpec;
}

export interface VectorIndexSpec {
  name: string;
  attribute: string;
  dimensions: number;
  distanceFunction: VectorDistanceFunction;
  projection: ProjectionSpec;
  searchSchema: Array<{name: string; type: SearchSchemaElementType}>;
}

export type TtlSpec =
  | {kind: 'enabled'; attribute: string}
  | {kind: 'disabled'}
  | {kind: 'unknown'}
  | {kind: 'not-provided'};

export interface ReplicaGsiOverride {
  name: string;
  readCapacity?: number;
  maxRead?: number;
}

export interface ReplicaSpec {
  region: string;
  status: string;
  /** The replica's own class when DescribeTable reports one; absent means unknown, and the table's applies. */
  tableClass?: TableClass;
  readCapacity?: number;
  maxRead?: number;
  gsiOverrides: ReplicaGsiOverride[];
  /** The replica's own KMS key, for a commented-out setting — never emitted live: DescribeTable cannot tell an AWS-managed key from a customer-managed one. */
  kmsKeyId?: string;
}

export interface TableSpec {
  tableName: string;
  /** Undefined only for a region-less single-region table (e.g. a DynamoDB Local paste). */
  homeRegion: string | undefined;
  keySchema: KeySpec[];
  attributeTypes: ReadonlyMap<string, ScalarAttributeType>;
  billing: BillingSpec;
  gsis: GsiSpec[];
  lsis: LsiSpec[];
  vectorIndexes: VectorIndexSpec[];
  ttl: TtlSpec;
  deletionProtection: boolean;
  stream: StreamViewType | undefined;
  /** `liveKeyArn` is for a commented-out setting only — never emitted live: DescribeTable cannot tell an AWS-managed key from a customer-managed one. */
  sse: {kind: 'kms'; liveKeyArn?: string} | undefined;
  tableClass: 'STANDARD_INFREQUENT_ACCESS' | undefined;
  replicas: ReplicaSpec[];
  consistency: MultiRegionConsistency;
  /** At most one: DynamoDB allows a single witness region. */
  witnesses: string[];
  /** Header lines about THIS table; every interpolated value is already comment-quoted. */
  notes: string[];
}

export type NormalizeResult = {ok: true; spec: TableSpec} | {ok: false; reason: string};

const NAME_PATTERN = /^[A-Za-z0-9_.-]{3,255}$/;
// Admits `eusc-de-east-1` (a 4-letter prefix) as well as the 2-letter ones.
export const REGION_PATTERN = /^[a-z]{2,4}(-[a-z]+)+-\d+$/;
const ARN_PATTERN = /^arn:[^:]+:dynamodb:([^:]*):([^:]*):table\//;

const SCALAR_TYPES = new Set<string>(['S', 'N', 'B']);
const PROJECTION_TYPES = new Set<string>(['ALL', 'KEYS_ONLY', 'INCLUDE']);
const STREAM_VIEW_TYPES = new Set<string>(['NEW_IMAGE', 'OLD_IMAGE', 'NEW_AND_OLD_IMAGES', 'KEYS_ONLY']);
const DISTANCE_FUNCTIONS = new Set<string>(['COSINE', 'DOT_PRODUCT', 'EUCLIDEAN']);
const SEARCH_ELEMENT_TYPES = new Set<string>(['HASH', 'INLINE_FILTER']);
const TABLE_CLASSES = new Set<string>(['STANDARD', 'STANDARD_INFREQUENT_ACCESS']);
const CONSISTENCY_MODES = new Set<string>(['EVENTUAL', 'STRONG']);
const MAX_GSI_HASH_KEYS = 4;
const MAX_GSI_RANGE_KEYS = 4;

class Refusal extends Error {}

function refuse(reason: string): never {
  throw new Refusal(reason);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function requireName(value: string | undefined, what: string): string {
  if (typeof value !== 'string' || !NAME_PATTERN.test(value)) {
    refuse(
      `The ${what} ${value === undefined ? 'is missing' : quoteForComment(value) + ' is not a valid DynamoDB name'} — expected 3–255 characters from A–Z, a–z, 0–9, "_", "-" and ".".`
    );
  }
  return value;
}

function requireRegion(value: string | undefined, what: string): string {
  if (typeof value !== 'string' || !REGION_PATTERN.test(value)) {
    refuse(`The ${what} ${value === undefined ? 'is missing' : quoteForComment(value) + ' is not an AWS region name'}.`);
  }
  return value;
}

function requireAttributeName(value: string | undefined, what: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    refuse(`The ${what} must be an attribute name of 1–255 characters.`);
  }
  return value;
}

function projectionOf(
  raw: {ProjectionType?: string; NonKeyAttributes?: string[]} | undefined,
  what: string
): ProjectionSpec {
  const type = raw?.ProjectionType;
  if (type === undefined || !PROJECTION_TYPES.has(type)) {
    refuse(`The ${what} projection type ${type === undefined ? 'is missing' : quoteForComment(type) + ' is not ALL, KEYS_ONLY or INCLUDE'}.`);
  }
  const nonKey = raw?.NonKeyAttributes ?? [];
  if (type === 'INCLUDE' && nonKey.length === 0) {
    refuse(`The ${what} projection is INCLUDE but lists no NonKeyAttributes.`);
  }
  return {
    type: type as ProjectionSpec['type'],
    nonKeyAttributes: nonKey.map((name, i) => requireAttributeName(name, `${what} NonKeyAttributes[${i}]`))
  };
}

/**
 * Key schemas must list every HASH before any RANGE, carry at least one HASH,
 * and reference only defined attributes. Tables and LSIs take one of each;
 * GSIs may take up to four of each (multi-attribute keys).
 */
function keySchemaOf(
  raw: KeySchemaElement[] | undefined,
  what: string,
  attributeTypes: ReadonlyMap<string, ScalarAttributeType>,
  limits: {hash: number; range: number}
): KeySpec[] {
  if (!raw || raw.length === 0) refuse(`The ${what} has no key schema.`);
  const keys: KeySpec[] = raw.map((k, i) => {
    const name = requireAttributeName(k.AttributeName, `${what} key #${i + 1}`);
    if (k.KeyType !== 'HASH' && k.KeyType !== 'RANGE') {
      refuse(`The ${what} key ${quoteForComment(name)} has key type ${quoteForComment(String(k.KeyType))} — expected HASH or RANGE.`);
    }
    if (!attributeTypes.has(name)) {
      refuse(`The ${what} key attribute ${quoteForComment(name)} has no entry in AttributeDefinitions — every key attribute needs a declared type.`);
    }
    return {name, type: k.KeyType};
  });
  const firstRange = keys.findIndex((k) => k.type === 'RANGE');
  const lastHash = keys.map((k) => k.type).lastIndexOf('HASH');
  if (lastHash === -1) refuse(`The ${what} key schema has no HASH key.`);
  if (firstRange !== -1 && firstRange < lastHash) {
    refuse(`The ${what} key schema lists a RANGE key before a HASH key — DynamoDB orders every HASH first.`);
  }
  const hashes = keys.filter((k) => k.type === 'HASH').length;
  const ranges = keys.length - hashes;
  if (hashes > limits.hash || ranges > limits.range) {
    refuse(`The ${what} key schema has ${hashes} HASH and ${ranges} RANGE keys — at most ${limits.hash} and ${limits.range} are allowed.`);
  }
  return keys;
}

function attributeTypesOf(table: DescribeTableTable): Map<string, ScalarAttributeType> {
  const types = new Map<string, ScalarAttributeType>();
  for (const [i, def] of (table.AttributeDefinitions ?? []).entries()) {
    const name = requireAttributeName(def.AttributeName, `AttributeDefinitions[${i}] name`);
    const type = def.AttributeType;
    if (type === undefined || !SCALAR_TYPES.has(type)) {
      refuse(`The attribute ${quoteForComment(name)} has type ${type === undefined ? 'missing' : quoteForComment(type)} — expected S, N or B.`);
    }
    const prior = types.get(name);
    if (prior !== undefined && prior !== type) {
      refuse(`The attribute ${quoteForComment(name)} is declared twice with different types (${prior} and ${type}).`);
    }
    types.set(name, type as ScalarAttributeType);
  }
  return types;
}

function throughputOf(
  raw: {ReadCapacityUnits?: number; WriteCapacityUnits?: number} | undefined,
  what: string
): Throughput {
  const read = raw?.ReadCapacityUnits;
  const write = raw?.WriteCapacityUnits;
  if (!isPositiveInteger(read) || !isPositiveInteger(write)) {
    refuse(`The ${what} is PROVISIONED but has no positive ReadCapacityUnits/WriteCapacityUnits.`);
  }
  return {read, write};
}

/** On-demand maxima: `-1` and absent both mean "unset" and are dropped. */
function onDemandMaxOf(
  raw: {MaxReadRequestUnits?: number; MaxWriteRequestUnits?: number} | undefined
): OnDemandMax {
  const max: OnDemandMax = {};
  if (isPositiveInteger(raw?.MaxReadRequestUnits)) max.maxRead = raw.MaxReadRequestUnits;
  if (isPositiveInteger(raw?.MaxWriteRequestUnits)) max.maxWrite = raw.MaxWriteRequestUnits;
  return max;
}

/**
 * `BillingModeSummary` is authoritative. It is absent on pre-2018 tables and on
 * every DynamoDB Local provisioned table, where a positive RCU still says
 * PROVISIONED; absent with zero capacity is unknowable, so it is refused
 * rather than guessed (the app's own reader returns "unknown" here — an
 * emitter cannot).
 */
function billingOf(table: DescribeTableTable): BillingSpec {
  const summary = table.BillingModeSummary?.BillingMode;
  const rcu = table.ProvisionedThroughput?.ReadCapacityUnits ?? 0;
  const mode =
    summary === 'PAY_PER_REQUEST' || summary === 'PROVISIONED'
      ? summary
      : summary === undefined && rcu > 0
        ? 'PROVISIONED'
        : undefined;
  if (mode === undefined) {
    refuse(
      summary === undefined
        ? 'Cannot determine the billing mode: the table has no BillingModeSummary and zero provisioned capacity.'
        : `The billing mode ${quoteForComment(String(summary))} is not PROVISIONED or PAY_PER_REQUEST.`
    );
  }
  if (mode === 'PROVISIONED') {
    return {mode, throughput: throughputOf(table.ProvisionedThroughput, 'table')};
  }
  return {mode, max: onDemandMaxOf(table.OnDemandThroughput)};
}

function gsisOf(
  table: DescribeTableTable,
  billing: BillingSpec,
  attributeTypes: ReadonlyMap<string, ScalarAttributeType>,
  notes: string[]
): GsiSpec[] {
  const out: GsiSpec[] = [];
  for (const raw of table.GlobalSecondaryIndexes ?? []) {
    const name = requireName(raw.IndexName, 'global secondary index name');
    if (raw.IndexStatus === 'DELETING') {
      notes.push(`Global secondary index ${quoteForComment(name)} is DELETING and was left out.`);
      continue;
    }
    const what = `global secondary index ${quoteForComment(name)}`;
    const spec: GsiSpec = {
      name,
      keySchema: keySchemaOf(raw.KeySchema, what, attributeTypes, {hash: MAX_GSI_HASH_KEYS, range: MAX_GSI_RANGE_KEYS}),
      projection: projectionOf(raw.Projection, what)
    };
    if (billing.mode === 'PROVISIONED') spec.throughput = throughputOf(raw.ProvisionedThroughput, what);
    else spec.max = onDemandMaxOf(raw.OnDemandThroughput);
    out.push(spec);
  }
  return out;
}

function lsisOf(
  table: DescribeTableTable,
  tableKeys: KeySpec[],
  attributeTypes: ReadonlyMap<string, ScalarAttributeType>
): LsiSpec[] {
  const tableHash = tableKeys[0]?.name;
  return (table.LocalSecondaryIndexes ?? []).map((raw: LocalSecondaryIndexDescription) => {
    const name = requireName(raw.IndexName, 'local secondary index name');
    const what = `local secondary index ${quoteForComment(name)}`;
    const keySchema = keySchemaOf(raw.KeySchema, what, attributeTypes, {hash: 1, range: 1});
    if (keySchema[0]?.name !== tableHash) {
      refuse(`The ${what} has HASH key ${quoteForComment(keySchema[0]?.name ?? '')} but a local secondary index must share the table's HASH key ${quoteForComment(tableHash ?? '')}.`);
    }
    if (keySchema.length !== 2) refuse(`The ${what} needs exactly one HASH and one RANGE key.`);
    return {name, keySchema, projection: projectionOf(raw.Projection, what)};
  });
}

function vectorIndexesOf(
  table: DescribeTableTable,
  attributeTypes: ReadonlyMap<string, ScalarAttributeType>,
  notes: string[]
): VectorIndexSpec[] {
  const out: VectorIndexSpec[] = [];
  for (const raw of table.VectorIndexes ?? []) {
    const name = requireName(raw.IndexName, 'vector index name');
    const attribute = raw.VectorAttribute?.AttributeName;
    const complete =
      attribute !== undefined &&
      isPositiveInteger(raw.Dimensions) &&
      raw.DistanceFunction !== undefined &&
      raw.Projection?.ProjectionType !== undefined;
    if (raw.IndexStatus === 'DELETING' || !complete) {
      notes.push(
        raw.IndexStatus === 'DELETING'
          ? `Vector index ${quoteForComment(name)} is DELETING and was left out.`
          : `Vector index ${quoteForComment(name)} is still being created (its definition is incomplete) and was left out.`
      );
      continue;
    }
    const what = `vector index ${quoteForComment(name)}`;
    if (!DISTANCE_FUNCTIONS.has(raw.DistanceFunction as string)) {
      refuse(`The ${what} distance function ${quoteForComment(String(raw.DistanceFunction))} is not COSINE, DOT_PRODUCT or EUCLIDEAN.`);
    }
    if ((raw.Dimensions as number) > 4096) refuse(`The ${what} has ${raw.Dimensions} dimensions — the maximum is 4096.`);
    out.push({
      name,
      attribute: requireAttributeName(attribute, `${what} vector attribute`),
      dimensions: raw.Dimensions as number,
      distanceFunction: raw.DistanceFunction as VectorIndexSpec['distanceFunction'],
      projection: projectionOf(raw.Projection, what),
      searchSchema: (raw.SearchSchema ?? []).map((el, i) => {
        const type = el.SearchSchemaElementType;
        if (type === undefined || !SEARCH_ELEMENT_TYPES.has(type)) {
          refuse(`The ${what} search schema element #${i + 1} has type ${type === undefined ? 'missing' : quoteForComment(type)} — expected HASH or INLINE_FILTER.`);
        }
        const name = requireAttributeName(el.AttributeName, `${what} search schema element #${i + 1}`);
        // The service refuses a vector index whose search schema names an
        // undeclared attribute (measured 2026-09-06), so a paste missing one
        // cannot describe a real table.
        if (!attributeTypes.has(name)) {
          refuse(`The ${what} search schema attribute ${quoteForComment(name)} has no entry in AttributeDefinitions.`);
        }
        return {name, type: type as 'HASH' | 'INLINE_FILTER'};
      })
    });
  }
  return out;
}

function ttlOf(input: TableDefinitionInput, notes: string[]): TtlSpec {
  const ttl = input.timeToLive;
  if (ttl === undefined) {
    notes.push('TTL: not provided — include the output of `aws dynamodb describe-time-to-live` to add it.');
    return {kind: 'not-provided'};
  }
  if (ttl === null) {
    notes.push('TTL: unknown — DescribeTimeToLive failed, so no TTL setting is emitted.');
    return {kind: 'unknown'};
  }
  const status = ttl.TimeToLiveStatus;
  if ((status === 'ENABLED' || status === 'ENABLING') && ttl.AttributeName) {
    return {kind: 'enabled', attribute: requireAttributeName(ttl.AttributeName, 'TTL attribute')};
  }
  return {kind: 'disabled'};
}

interface ArnParts {
  region: string;
  account: string;
}

function arnParts(arn: string | undefined): ArnParts | undefined {
  const match = arn === undefined ? null : ARN_PATTERN.exec(arn);
  return match ? {region: match[1] as string, account: match[2] as string} : undefined;
}

/**
 * The home region is the `TableArn` region when that is a real AWS region
 * (DynamoDB Local's is the literal `ddblocal`), else `input.region`. A real
 * ARN region and an `input.region` that disagree is a mismatch, never a guess.
 */
function homeRegionOf(table: DescribeTableTable, input: TableDefinitionInput): string | undefined {
  const arnRegion = arnParts(table.TableArn)?.region;
  const realArnRegion = arnRegion !== undefined && REGION_PATTERN.test(arnRegion) ? arnRegion : undefined;
  const given = input.region === undefined ? undefined : requireRegion(input.region, 'region');
  if (realArnRegion !== undefined && given !== undefined && realArnRegion !== given) {
    refuse(`The table's ARN is in ${realArnRegion} but the region given is ${given} — they must agree.`);
  }
  return realArnRegion ?? given;
}

function replicasOf(
  table: DescribeTableTable,
  homeRegion: string | undefined,
  consistency: 'EVENTUAL' | 'STRONG',
  notes: string[]
): ReplicaSpec[] {
  const raw = table.Replicas ?? [];
  if (raw.length === 0) return [];
  if (homeRegion === undefined) {
    refuse('Cannot identify the table\'s own region (no real TableArn region and no region given), which a global table export needs to place the home replica.');
  }
  const homeAccount = arnParts(table.TableArn)?.account;
  const out: ReplicaSpec[] = [];
  for (const r of raw) {
    const region = requireRegion(r.RegionName, 'replica region');
    const status = r.ReplicaStatus ?? 'ACTIVE';
    if (region === homeRegion) continue;
    const account = arnParts(r.ReplicaArn)?.account;
    if (homeAccount !== undefined && account !== undefined && account !== homeAccount) {
      notes.push(`Replica in ${region} belongs to account ${quoteForComment(account)} and was left out — manage it from that account.`);
      continue;
    }
    if (status === 'DELETING') {
      if (consistency === 'STRONG') {
        refuse(`The replica in ${region} is DELETING on a strongly consistent global table — export again once the deletion has finished.`);
      }
      notes.push(`Replica in ${region} is DELETING and was left out.`);
      continue;
    }
    if (status !== 'ACTIVE') {
      notes.push(`Replica in ${region} is ${quoteForComment(status)} (kept: leaving a live replica out would make an apply delete it).`);
    }
    out.push(replicaSpecOf(r, region, status));
  }
  return out;
}

function replicaSpecOf(r: ReplicaDescription, region: string, status: string): ReplicaSpec {
  const spec: ReplicaSpec = {region, status, gsiOverrides: []};
  if (r.KMSMasterKeyId) spec.kmsKeyId = r.KMSMasterKeyId;
  const replicaClass = r.ReplicaTableClassSummary?.TableClass;
  if (replicaClass !== undefined) {
    if (!TABLE_CLASSES.has(replicaClass)) {
      refuse(`The replica in ${region} has table class ${quoteForComment(String(replicaClass))} — expected STANDARD or STANDARD_INFREQUENT_ACCESS.`);
    }
    spec.tableClass = replicaClass as TableClass;
  }
  if (isPositiveInteger(r.ProvisionedThroughputOverride?.ReadCapacityUnits)) {
    spec.readCapacity = r.ProvisionedThroughputOverride.ReadCapacityUnits;
  }
  if (isPositiveInteger(r.OnDemandThroughputOverride?.MaxReadRequestUnits)) {
    spec.maxRead = r.OnDemandThroughputOverride.MaxReadRequestUnits;
  }
  for (const g of r.GlobalSecondaryIndexes ?? []) {
    const name = requireName(g.IndexName, `replica ${region} index override name`);
    const override: ReplicaGsiOverride = {name};
    if (isPositiveInteger(g.ProvisionedThroughputOverride?.ReadCapacityUnits)) {
      override.readCapacity = g.ProvisionedThroughputOverride.ReadCapacityUnits;
    }
    if (isPositiveInteger(g.OnDemandThroughputOverride?.MaxReadRequestUnits)) {
      override.maxRead = g.OnDemandThroughputOverride.MaxReadRequestUnits;
    }
    if (override.readCapacity !== undefined || override.maxRead !== undefined) spec.gsiOverrides.push(override);
  }
  return spec;
}

function normalizeOrThrow(input: TableDefinitionInput): TableSpec {
  const table = input.table;
  const notes: string[] = [];
  const tableName = requireName(table.TableName, 'table name');
  const attributeTypes = attributeTypesOf(table);
  const keySchema = keySchemaOf(table.KeySchema, 'table', attributeTypes, {hash: 1, range: 1});
  const billing = billingOf(table);
  const gsis = gsisOf(table, billing, attributeTypes, notes);
  const lsis = lsisOf(table, keySchema, attributeTypes);
  const vectorIndexes = vectorIndexesOf(table, attributeTypes, notes);

  const streamRaw = table.StreamSpecification;
  let stream: TableSpec['stream'];
  if (streamRaw?.StreamEnabled) {
    if (streamRaw.StreamViewType === undefined || !STREAM_VIEW_TYPES.has(streamRaw.StreamViewType)) {
      refuse('The stream is enabled but StreamViewType is missing or not one of NEW_IMAGE, OLD_IMAGE, NEW_AND_OLD_IMAGES, KEYS_ONLY.');
    }
    stream = streamRaw.StreamViewType as TableSpec['stream'];
  }

  let sse: TableSpec['sse'];
  const sseRaw = table.SSEDescription;
  if (sseRaw?.Status === 'ENABLED' && sseRaw.SSEType === 'KMS') {
    sse = sseRaw.KMSMasterKeyArn ? {kind: 'kms', liveKeyArn: sseRaw.KMSMasterKeyArn} : {kind: 'kms'};
    if (sseRaw.KMSMasterKeyArn) {
      notes.push(`SSE uses KMS key ${quoteForComment(sseRaw.KMSMasterKeyArn)} — if that is a customer-managed key, set it on the emitted encryption setting.`);
    }
  }

  const rawConsistency = table.MultiRegionConsistency;
  if (rawConsistency !== undefined && !CONSISTENCY_MODES.has(rawConsistency)) {
    refuse(`MultiRegionConsistency ${quoteForComment(String(rawConsistency))} is not EVENTUAL or STRONG.`);
  }
  const consistency: MultiRegionConsistency = rawConsistency === 'STRONG' ? 'STRONG' : 'EVENTUAL';
  const homeRegion = homeRegionOf(table, input);
  const replicas = replicasOf(table, homeRegion, consistency, notes);
  const witnesses = (table.GlobalTableWitnesses ?? []).map((w) => requireRegion(w.RegionName, 'witness region'));
  if (witnesses.length > 1) {
    refuse(`DynamoDB allows one witness region and this table lists ${witnesses.length} (${witnesses.join(', ')}).`);
  }
  const rawTableClass = table.TableClassSummary?.TableClass;
  if (rawTableClass !== undefined && !TABLE_CLASSES.has(rawTableClass)) {
    refuse(`The table class ${quoteForComment(String(rawTableClass))} is not STANDARD or STANDARD_INFREQUENT_ACCESS.`);
  }
  for (const r of table.Replicas ?? []) {
    if (r.KMSMasterKeyId && replicas.some((s) => s.region === r.RegionName)) {
      notes.push(`Replica in ${r.RegionName} uses KMS key ${quoteForComment(r.KMSMasterKeyId)} — set it on that replica if it is customer-managed.`);
    }
  }

  return {
    tableName,
    homeRegion,
    keySchema,
    attributeTypes,
    billing,
    gsis,
    lsis,
    vectorIndexes,
    ttl: ttlOf(input, notes),
    deletionProtection: table.DeletionProtectionEnabled === true,
    stream,
    sse,
    tableClass: rawTableClass === 'STANDARD_INFREQUENT_ACCESS' ? 'STANDARD_INFREQUENT_ACCESS' : undefined,
    replicas,
    consistency,
    witnesses,
    notes
  };
}

export function normalize(input: TableDefinitionInput): NormalizeResult {
  try {
    return {ok: true, spec: normalizeOrThrow(input)};
  } catch (error) {
    if (error instanceof Refusal) return {ok: false, reason: error.message};
    throw error;
  }
}

/**
 * The attribute definitions a target must declare: exactly the attributes its
 * emitted key schemas reference, in first-appearance order (table keys, GSIs,
 * LSIs, then — when the target emits vector indexes — their search-schema
 * attributes). Terraform emits no
 * vector block and therefore never defines a vector-only attribute, which its
 * provider would reject as unindexed.
 */
export function referencedAttributes(
  spec: TableSpec,
  opts: {vectorIndexes: boolean}
): Array<{name: string; type: ScalarAttributeType}> {
  const names: string[] = [];
  const add = (name: string) => {
    if (!names.includes(name) && spec.attributeTypes.has(name)) names.push(name);
  };
  for (const k of spec.keySchema) add(k.name);
  for (const g of spec.gsis) for (const k of g.keySchema) add(k.name);
  for (const l of spec.lsis) for (const k of l.keySchema) add(k.name);
  // The vector attribute itself is a list and can never be declared (S/N/B
  // only); its search-schema attributes are scalars the service requires
  // declared, and normalize() has already checked they are.
  if (opts.vectorIndexes) {
    for (const v of spec.vectorIndexes) for (const el of v.searchSchema) add(el.name);
  }
  return names.map((name) => ({name, type: spec.attributeTypes.get(name) as ScalarAttributeType}));
}
