// Independent comparators for the real-tool validators (scripts/validate-*.ts).
//
// Everything here is derived from the RAW fixture JSON plus the golden's
// recorded `input.region` (tests/fixtures/goldens.json) with its own reading of
// the DescribeTable shape — it deliberately shares NOTHING with src/normalize.ts,
// so a wrong derivation there cannot also be wrong here. Where a rule in the
// emitters is a design decision (D1 home region, EVENTUAL stream, replica
// filter) the SAME decision is restated, not imported.
//
// Erasable TypeScript only: the validators run this under `node` type-stripping.

// --- raw DescribeTable shape (only what the comparators read) ---

export type RawKey = {AttributeName: string; KeyType: 'HASH' | 'RANGE'};
export type RawProjection = {ProjectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE'; NonKeyAttributes?: string[]};
export type RawThroughput = {ReadCapacityUnits?: number; WriteCapacityUnits?: number};
export type RawOnDemand = {MaxReadRequestUnits?: number; MaxWriteRequestUnits?: number};
export type RawGsi = {
  IndexName: string;
  IndexStatus?: string;
  KeySchema: RawKey[];
  Projection: RawProjection;
  ProvisionedThroughput?: RawThroughput;
  OnDemandThroughput?: RawOnDemand;
};
export type RawReplica = {
  RegionName: string;
  ReplicaStatus?: string;
  ReplicaArn?: string;
  ReplicaTableClassSummary?: {TableClass?: string};
  ProvisionedThroughputOverride?: {ReadCapacityUnits?: number};
  OnDemandThroughputOverride?: {MaxReadRequestUnits?: number};
  GlobalSecondaryIndexes?: Array<{
    IndexName: string;
    ProvisionedThroughputOverride?: {ReadCapacityUnits?: number};
    OnDemandThroughputOverride?: {MaxReadRequestUnits?: number};
  }>;
};
export type RawTable = {
  TableName: string;
  TableArn?: string;
  KeySchema: RawKey[];
  AttributeDefinitions: Array<{AttributeName: string; AttributeType: 'S' | 'N' | 'B'}>;
  BillingModeSummary?: {BillingMode?: 'PROVISIONED' | 'PAY_PER_REQUEST'};
  ProvisionedThroughput?: RawThroughput;
  OnDemandThroughput?: RawOnDemand;
  GlobalSecondaryIndexes?: RawGsi[];
  LocalSecondaryIndexes?: Array<{IndexName: string; KeySchema: RawKey[]; Projection: RawProjection}>;
  StreamSpecification?: {StreamEnabled?: boolean; StreamViewType?: string};
  SSEDescription?: {Status?: string; SSEType?: string};
  TableClassSummary?: {TableClass?: string};
  DeletionProtectionEnabled?: boolean;
  Replicas?: RawReplica[];
  MultiRegionConsistency?: 'EVENTUAL' | 'STRONG';
  GlobalTableWitnesses?: Array<{RegionName: string}>;
};
export type RawTtl = {TimeToLiveStatus?: string; AttributeName?: string} | undefined;

const REGION = /^[a-z]{2,4}(-[a-z]+)+-\d+$/;
const ARN = /^arn:[^:]+:dynamodb:([^:]*):(\d*):table\//;

/** The home-region rule restated: the ARN's region when it is a real one, else the recorded `input.region`, else none. */
export function deriveHome(table: RawTable, recordedRegion: string | undefined): string | undefined {
  const arnRegion = table.TableArn === undefined ? undefined : ARN.exec(table.TableArn)?.[1];
  if (arnRegion !== undefined && REGION.test(arnRegion)) return arnRegion;
  return recordedRegion;
}

function homeAccount(table: RawTable): string | undefined {
  return table.TableArn === undefined ? undefined : ARN.exec(table.TableArn)?.[2];
}

/** The replicas an export keeps: not DELETING, same account as the home table, not the home region. */
export function keptReplicas(table: RawTable, home: string | undefined): RawReplica[] {
  const account = homeAccount(table);
  return (table.Replicas ?? []).filter((r) => {
    if (r.ReplicaStatus === 'DELETING') return false;
    if (r.RegionName === home) return false;
    const replicaAccount = r.ReplicaArn === undefined ? undefined : ARN.exec(r.ReplicaArn)?.[2];
    return replicaAccount === undefined || account === undefined || replicaAccount === account;
  });
}

export function billingMode(table: RawTable): 'PROVISIONED' | 'PAY_PER_REQUEST' {
  // DynamoDB Local omits BillingModeSummary on provisioned tables; the API
  // documents the field as absent for tables that pre-date on-demand.
  return table.BillingModeSummary?.BillingMode ?? 'PROVISIONED';
}

/** The GSIs an export keeps: a DELETING index is on its way out and is left out. */
export function keptGsis(table: RawTable): RawGsi[] {
  return (table.GlobalSecondaryIndexes ?? []).filter((g) => g.IndexStatus !== 'DELETING');
}

export function keyAttributeNames(table: RawTable): string[] {
  const names: string[] = [];
  const add = (k: RawKey) => {
    if (!names.includes(k.AttributeName)) names.push(k.AttributeName);
  };
  table.KeySchema.forEach(add);
  for (const g of keptGsis(table)) g.KeySchema.forEach(add);
  for (const l of table.LocalSecondaryIndexes ?? []) l.KeySchema.forEach(add);
  return names;
}

/** Deterministic JSON (keys sorted at every depth) for byte comparison and diffs. */
export function stableJson(v: unknown): string {
  return JSON.stringify(sortKeysDeep(v), null, 2);
}

// --- Terraform: the projection of `terraform show -json` planned values we assert on ---

type Json = null | boolean | number | string | Json[] | {[key: string]: Json};

export type TerraformExpectation = {
  values: Record<string, Json | undefined>;
  /** The region the golden must declare on its provider block, or none. */
  providerRegion: string | undefined;
};

function sortBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

function odt(v: RawOnDemand | undefined): Json | undefined {
  const read = v?.MaxReadRequestUnits;
  const write = v?.MaxWriteRequestUnits;
  const out: {[key: string]: Json} = {};
  if (read !== undefined && read > 0) out.max_read_request_units = read;
  if (write !== undefined && write > 0) out.max_write_request_units = write;
  return Object.keys(out).length === 0 ? undefined : [out];
}

export function terraformExpectation(table: RawTable, recordedRegion: string | undefined, ttl: RawTtl): TerraformExpectation {
  const home = deriveHome(table, recordedRegion);
  const mode = billingMode(table);
  const replicas = keptReplicas(table, home);
  const consistency = table.MultiRegionConsistency ?? 'EVENTUAL';
  const streamForced = replicas.length > 0 && consistency === 'EVENTUAL';
  const streamView = streamForced
    ? 'NEW_AND_OLD_IMAGES'
    : table.StreamSpecification?.StreamEnabled
      ? table.StreamSpecification.StreamViewType
      : undefined;
  const types = new Map(table.AttributeDefinitions.map((a) => [a.AttributeName, a.AttributeType]));

  const values: Record<string, Json | undefined> = {
    name: table.TableName,
    billing_mode: mode,
    hash_key: table.KeySchema.find((k) => k.KeyType === 'HASH')?.AttributeName,
    // Absent (not null) when there is no sort key — the plan omits the attribute.
    range_key: table.KeySchema.find((k) => k.KeyType === 'RANGE')?.AttributeName,
    // `attribute` is a set: the plan lists it sorted by name.
    attribute: sortBy(keyAttributeNames(table), (n) => n).map((n) => ({name: n, type: types.get(n) ?? null})),
    // Absent (measured `null`) when the table has no GSI, where an empty LSI/replica set is `[]`.
    global_secondary_index: keptGsis(table).length === 0 ? undefined : sortBy(keptGsis(table), (g) => g.IndexName).map((g) => {
      const gsi: {[key: string]: Json} = {
        name: g.IndexName,
        // Order is the wire order — a multi-attribute key's HASH/RANGE sequence is meaning.
        key_schema: g.KeySchema.map((k) => ({attribute_name: k.AttributeName, key_type: k.KeyType})),
        projection_type: g.Projection.ProjectionType,
        non_key_attributes: sortBy(g.Projection.NonKeyAttributes ?? [], (n) => n)
      };
      if (mode === 'PROVISIONED') {
        gsi.read_capacity = g.ProvisionedThroughput?.ReadCapacityUnits ?? null;
        gsi.write_capacity = g.ProvisionedThroughput?.WriteCapacityUnits ?? null;
      }
      gsi.on_demand_throughput = odt(g.OnDemandThroughput) ?? [];
      return gsi;
    }),
    local_secondary_index: sortBy(table.LocalSecondaryIndexes ?? [], (l) => l.IndexName).map((l) => ({
      name: l.IndexName,
      range_key: l.KeySchema.find((k) => k.KeyType === 'RANGE')?.AttributeName ?? null,
      projection_type: l.Projection.ProjectionType,
      non_key_attributes: sortBy(l.Projection.NonKeyAttributes ?? [], (n) => n)
    })),
    read_capacity: mode === 'PROVISIONED' ? (table.ProvisionedThroughput?.ReadCapacityUnits ?? null) : undefined,
    write_capacity: mode === 'PROVISIONED' ? (table.ProvisionedThroughput?.WriteCapacityUnits ?? null) : undefined,
    on_demand_throughput: mode === 'PAY_PER_REQUEST' ? (odt(table.OnDemandThroughput) ?? []) : [],
    stream_enabled: streamView === undefined ? undefined : true,
    stream_view_type: streamView,
    server_side_encryption:
      table.SSEDescription?.SSEType === 'KMS' && table.SSEDescription.Status !== 'DISABLED' ? [{enabled: true}] : undefined,
    table_class: table.TableClassSummary?.TableClass === 'STANDARD_INFREQUENT_ACCESS' ? 'STANDARD_INFREQUENT_ACCESS' : undefined,
    deletion_protection_enabled: table.DeletionProtectionEnabled === true ? true : undefined,
    // `replica` is a set too (sorted by region); the plan fills three defaults the golden never writes.
    replica: sortBy(replicas, (r) => r.RegionName).map((r) => ({
      region_name: r.RegionName,
      consistency_mode: consistency,
      point_in_time_recovery: false,
      propagate_tags: false
    })),
    // Present only when TTL is on; a disabled or unknown TTL writes no block and the plan reports it as computed.
    ttl:
      ttl?.TimeToLiveStatus === 'ENABLED' && ttl.AttributeName !== undefined
        ? [{attribute_name: ttl.AttributeName, enabled: true}]
        : undefined,
    // Absent when there is no witness: the plan reports the block as computed, not empty.
    global_table_witness:
      table.GlobalTableWitnesses === undefined || table.GlobalTableWitnesses.length === 0
        ? undefined
        : sortBy(table.GlobalTableWitnesses, (w) => w.RegionName).map((w) => ({region_name: w.RegionName}))
  };
  return {values, providerRegion: home};
}

/**
 * The same keys read off the plan, null → undefined, every set (attributes,
 * indexes, replicas, witnesses, non-key attributes) sorted the way the
 * expectation sorts it — the provider's set order is not a contract.
 */
export function projectTerraformValues(
  actual: Record<string, unknown>,
  expectation: TerraformExpectation
): Record<string, Json | undefined> {
  const out: Record<string, Json | undefined> = {};
  for (const key of Object.keys(expectation.values)) {
    const v = actual[key];
    out[key] = v === null || v === undefined ? undefined : projectKnown(key, v as Json);
  }
  return out;
}

function name(o: Json, field: string): string {
  return String((o as {[key: string]: Json})[field]);
}

function projectKnown(key: string, v: Json): Json {
  if (key === 'attribute' && Array.isArray(v)) return sortBy(v, (a) => name(a, 'name'));
  if (key === 'server_side_encryption' && Array.isArray(v)) {
    return v.map((b) => ({enabled: (b as {[key: string]: Json}).enabled}));
  }
  if (key === 'global_secondary_index' && Array.isArray(v)) {
    return sortBy(v, (g) => name(g, 'name')).map((g) => {
      const o = g as {[key: string]: Json};
      const out: {[key: string]: Json} = {
        name: o.name,
        key_schema: o.key_schema,
        projection_type: o.projection_type,
        non_key_attributes: sortBy((o.non_key_attributes as Json[] | undefined) ?? [], String)
      };
      if (o.read_capacity !== undefined) out.read_capacity = o.read_capacity;
      if (o.write_capacity !== undefined) out.write_capacity = o.write_capacity;
      out.on_demand_throughput = o.on_demand_throughput ?? [];
      return out;
    });
  }
  if (key === 'local_secondary_index' && Array.isArray(v)) {
    return sortBy(v, (l) => name(l, 'name')).map((l) => {
      const o = l as {[key: string]: Json};
      return {
        name: o.name,
        range_key: o.range_key,
        projection_type: o.projection_type,
        non_key_attributes: sortBy((o.non_key_attributes as Json[] | undefined) ?? [], String)
      };
    });
  }
  if (key === 'replica' && Array.isArray(v)) {
    return sortBy(v, (r) => name(r, 'region_name')).map((r) => {
      const o = r as {[key: string]: Json};
      return {
        region_name: o.region_name,
        consistency_mode: o.consistency_mode,
        point_in_time_recovery: o.point_in_time_recovery,
        propagate_tags: o.propagate_tags
      };
    });
  }
  if (key === 'global_table_witness' && Array.isArray(v)) {
    return sortBy(v, (w) => name(w, 'region_name')).map((w) => ({region_name: (w as {[key: string]: Json}).region_name}));
  }
  return v;
}

// --- CloudFormation ⇄ CDK: canonical form of a GlobalTable's Properties ---

type Props = {[key: string]: unknown};

function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Props)
        .sort()
        .map((k) => [k, sortKeysDeep((v as Props)[k])])
    );
  }
  return v;
}

/**
 * Serialization differences between CDK's synth and the CFN emitter, each
 * measured on aws-cdk-lib 2.270/2.271 (2026-09-26):
 *  1. `Replicas` order — TableV2 lists non-home replicas first and the home
 *     region LAST; the emitter writes home first. Both are the same set.
 *  2. TableV2 writes a `{IndexName}`-only entry under every replica's
 *     `GlobalSecondaryIndexes` for every GSI (configureReplicaGlobalSecondaryIndexes
 *     iterates the table's GSIs); the emitter writes an entry only when it
 *     carries a read setting. An entry with nothing but a name says nothing.
 * Everything else is deep-equal already (AttributeDefinitions order included).
 */
export function canonicalGlobalTableProperties(props: Props): Props {
  const out: Props = {...props};
  if (Array.isArray(out.Replicas)) {
    out.Replicas = sortBy(
      (out.Replicas as Props[]).map((r) => {
        const replica: Props = {...r};
        if (Array.isArray(replica.GlobalSecondaryIndexes)) {
          const kept = (replica.GlobalSecondaryIndexes as Props[]).filter((g) => Object.keys(g).length > 1);
          if (kept.length === 0) delete replica.GlobalSecondaryIndexes;
          else replica.GlobalSecondaryIndexes = kept;
        }
        return replica;
      }),
      (r) => JSON.stringify(r.Region)
    );
  }
  return sortKeysDeep(out) as Props;
}

export type CdkDivergence = {
  /** Sentence the CDK golden's header MUST carry for this exception to be allowed. */
  headerSentence: string;
  applied: boolean;
};

/**
 * The two accepted TableV2 divergences, applied to the CDK side ONLY when present,
 * each reported so the caller can require the CDK file's header to state it.
 *  - deletion protection: `configureReplicaTable` falls back to the table's
 *    `deletionProtection` for every replica.
 *  - STRONG stream: `renderStreamSpecification` forces NEW_AND_OLD_IMAGES
 *    whenever a replica exists and `dynamoStream` is unset.
 */
export function applyCdkDivergences(cdk: Props, cfn: Props): {cdk: Props; divergences: CdkDivergence[]} {
  const out: Props = {...cdk};
  const home = Array.isArray(cfn.Replicas) ? JSON.stringify((cfn.Replicas[0] as Props).Region) : undefined;
  const divergences: CdkDivergence[] = [];

  let strippedProtection = false;
  if (Array.isArray(out.Replicas)) {
    out.Replicas = (out.Replicas as Props[]).map((r) => {
      if (JSON.stringify(r.Region) === home || r.DeletionProtectionEnabled !== true) return r;
      strippedProtection = true;
      const {DeletionProtectionEnabled: _dropped, ...rest} = r;
      return rest;
    });
  }
  divergences.push({
    headerSentence: "TableV2 applies the table's deletion protection to every replica",
    applied: strippedProtection
  });

  let strippedStream = false;
  if (cfn.StreamSpecification === undefined && out.StreamSpecification !== undefined && out.MultiRegionConsistency === 'STRONG') {
    strippedStream = true;
    delete out.StreamSpecification;
  }
  divergences.push({
    headerSentence: 'TableV2 attaches a NEW_AND_OLD_IMAGES stream to every global table',
    applied: strippedStream
  });

  return {cdk: out, divergences};
}
