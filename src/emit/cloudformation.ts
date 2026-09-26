import {pascalId} from '../names';
import {normalize, referencedAttributes} from '../normalize';
import type {GsiSpec, KeySpec, ProjectionSpec, ReplicaSpec, TableSpec, VectorIndexSpec} from '../normalize';
import {NOT_EMITTED} from '../not-emitted';
import type {EmitResult, TableDefinitionInput} from '../types';
import {quoteForComment} from '../escape';
import {ADOPTION_HINT_CFN, effectiveStreamView, headerNotes, sourceDescription} from './common';
import {quoted, renderYaml, toJsonValue} from './yaml';
import type {YamlMap, YamlNode} from './yaml';

// CloudFormation `AWS::DynamoDB::GlobalTable` — always, single-region tables
// included (one replica = the home region): the same resource type the CDK
// output synthesizes, so the two can be compared resource for resource.
// GlobalTable expresses provisioned WRITE capacity only as auto-scaling, so a
// provisioned table gets min = max = its current WCU; READ capacity is per
// replica (and per replica GSI); TableClass and DeletionProtectionEnabled are
// per replica too.
//
// Verified against aws-dynamodb-globaltable.json (CloudformationSchema.zip,
// 2026-09-26): GSI `KeySchema` takes 1–8 elements, so a multi-attribute GSI
// (fixture e, 2 HASH + 2 RANGE) is emitted, not refused; vector `SearchSchema`
// attributes are ordinary `AttributeDefinitions` entries (the service refuses
// an index whose SearchSchema names an undeclared attribute), hence
// `referencedAttributes(spec, {vectorIndexes: true})`; `WarmThroughput` exists
// on the table and per GSI and is deliberately never emitted (NOT_EMITTED).

const TARGET_UTILIZATION = 70;

export type CloudFormationSyntax = 'yaml' | 'json';

export interface CloudFormationOptions {
  syntax: CloudFormationSyntax;
}

function keySchema(keys: KeySpec[]): YamlNode[] {
  return keys.map((k) => ({AttributeName: quoted(k.name), KeyType: k.type}));
}

function projection(p: ProjectionSpec): YamlMap {
  const node: YamlMap = {ProjectionType: p.type};
  if (p.type === 'INCLUDE') node.NonKeyAttributes = p.nonKeyAttributes.map(quoted);
  return node;
}

function writeAutoScaling(units: number): YamlMap {
  return {
    WriteCapacityAutoScalingSettings: {
      MinCapacity: units,
      MaxCapacity: units,
      TargetTrackingScalingPolicyConfiguration: {TargetValue: TARGET_UTILIZATION}
    }
  };
}

/** A PROVISIONED table's GSI always carries throughput (normalize guarantees it); anything else is a bug. */
function provisionedRead(g: GsiSpec): number {
  if (g.throughput === undefined) throw new Error(`GSI ${JSON.stringify(g.name)} has no provisioned throughput on a PROVISIONED table`);
  return g.throughput.read;
}

function gsi(spec: TableSpec, g: GsiSpec): YamlMap {
  const node: YamlMap = {IndexName: quoted(g.name), KeySchema: keySchema(g.keySchema), Projection: projection(g.projection)};
  if (g.throughput) {
    node.WriteProvisionedThroughputSettings = writeAutoScaling(g.throughput.write);
  } else if (g.max?.maxWrite !== undefined) {
    node.WriteOnDemandThroughputSettings = {MaxWriteRequestUnits: g.max.maxWrite};
  }
  return node;
}

/** The `AttributeDefinitions` list, incl. vector search-schema attributes — shared with the CDK L1 override. */
export function cfnAttributeDefinitions(spec: TableSpec): YamlNode[] {
  return referencedAttributes(spec, {vectorIndexes: true}).map((a) => ({
    AttributeName: quoted(a.name),
    // Quoted: a bare `N` is a YAML 1.1 boolean word (y|Y|n|N), and the CloudFormation
    // parser is YAML 1.1.
    AttributeType: quoted(a.type)
  }));
}

/** One `VectorIndexes[]` entry — shared with the CDK L1 override. */
export function cfnVectorIndex(v: VectorIndexSpec): YamlMap {
  const node: YamlMap = {
    IndexName: quoted(v.name),
    VectorAttribute: {AttributeName: quoted(v.attribute)},
    Dimensions: v.dimensions,
    DistanceFunction: v.distanceFunction,
    Projection: projection(v.projection)
  };
  if (v.searchSchema.length > 0) {
    node.SearchSchema = v.searchSchema.map((el) => ({AttributeName: quoted(el.name), SearchSchemaElementType: el.type}));
  }
  return node;
}

/**
 * One `Replicas[]` entry. `home` is the table's own region (or `undefined` for
 * a region-less table, which becomes the stack's region); `override` is the
 * replica's own description for a non-home replica.
 */
function replica(spec: TableSpec, region: YamlNode, override: ReplicaSpec | undefined): YamlMap {
  const node: YamlMap = {Region: region};
  if (override === undefined && spec.deletionProtection) node.DeletionProtectionEnabled = true;
  // Written when infrequent-access, and when a replica is STANDARD under an
  // infrequent-access home — the one case a reader would infer wrongly.
  const homeClass = spec.tableClass ?? 'STANDARD';
  const tableClass = override?.tableClass ?? homeClass;
  if (tableClass === 'STANDARD_INFREQUENT_ACCESS' || tableClass !== homeClass) node.TableClass = tableClass;

  if (spec.billing.mode === 'PROVISIONED') {
    node.ReadProvisionedThroughputSettings = {
      ReadCapacityUnits: override?.readCapacity ?? spec.billing.throughput.read
    };
    const indexes = spec.gsis.map((g) => ({
      IndexName: quoted(g.name),
      ReadProvisionedThroughputSettings: {
        ReadCapacityUnits:
          override?.gsiOverrides.find((o) => o.name === g.name)?.readCapacity ?? provisionedRead(g)
      }
    }));
    if (indexes.length > 0) node.GlobalSecondaryIndexes = indexes;
  } else {
    const maxRead = override?.maxRead ?? spec.billing.max.maxRead;
    if (maxRead !== undefined) node.ReadOnDemandThroughputSettings = {MaxReadRequestUnits: maxRead};
    const indexes: YamlNode[] = [];
    for (const g of spec.gsis) {
      const gsiMax = override?.gsiOverrides.find((o) => o.name === g.name)?.maxRead ?? g.max?.maxRead;
      if (gsiMax !== undefined) {
        indexes.push({IndexName: quoted(g.name), ReadOnDemandThroughputSettings: {MaxReadRequestUnits: gsiMax}});
      }
    }
    if (indexes.length > 0) node.GlobalSecondaryIndexes = indexes;
  }
  return node;
}

function properties(spec: TableSpec): YamlMap {
  const props: YamlMap = {
    TableName: quoted(spec.tableName),
    BillingMode: spec.billing.mode,
    AttributeDefinitions: cfnAttributeDefinitions(spec),
    KeySchema: keySchema(spec.keySchema)
  };
  if (spec.gsis.length > 0) props.GlobalSecondaryIndexes = spec.gsis.map((g) => gsi(spec, g));
  if (spec.lsis.length > 0) {
    props.LocalSecondaryIndexes = spec.lsis.map((l) => ({
      IndexName: quoted(l.name),
      KeySchema: keySchema(l.keySchema),
      Projection: projection(l.projection)
    }));
  }
  if (spec.vectorIndexes.length > 0) props.VectorIndexes = spec.vectorIndexes.map(cfnVectorIndex);
  if (spec.ttl.kind === 'enabled') {
    props.TimeToLiveSpecification = {AttributeName: quoted(spec.ttl.attribute), Enabled: true};
  }
  const streamView = effectiveStreamView(spec);
  if (streamView) props.StreamSpecification = {StreamViewType: streamView};
  if (spec.sse) props.SSESpecification = {SSEEnabled: true, SSEType: 'KMS'};
  if (spec.billing.mode === 'PROVISIONED') {
    props.WriteProvisionedThroughputSettings = writeAutoScaling(spec.billing.throughput.write);
  } else if (spec.billing.max.maxWrite !== undefined) {
    props.WriteOnDemandThroughputSettings = {MaxWriteRequestUnits: spec.billing.max.maxWrite};
  }
  if (spec.consistency === 'STRONG') props.MultiRegionConsistency = 'STRONG';
  if (spec.witnesses.length > 0) props.GlobalTableWitnesses = spec.witnesses.map((w) => ({Region: w}));

  const home: YamlNode = spec.homeRegion ?? {Ref: quoted('AWS::Region')};
  props.Replicas = [replica(spec, home, undefined), ...spec.replicas.map((r) => replica(spec, r.region, r))];
  return props;
}

const PROVISIONED_NOTE =
  'Provisioned write capacity is emitted as write auto-scaling with min = max = the current WCU (AWS::DynamoDB::GlobalTable accepts no fixed write capacity); the live scaling policy is not part of DescribeTable.';

export function buildCloudFormationTemplate(spec: TableSpec): {template: YamlMap; logicalId: string} {
  const logicalId = pascalId(spec.tableName);
  const description = `DynamoDB table ${spec.tableName}, generated by dynamodb-table-iac from describe-table output`;
  const metadata: YamlMap = {
    Source: quoted(sourceDescription(spec)),
    NotEmitted: NOT_EMITTED.map(quoted)
  };
  const notes = headerNotes(spec, {
    regionUnknown: "; the home replica is the stack's own region (Ref AWS::Region).",
    provisioned: PROVISIONED_NOTE
  });
  if (notes.length > 0) metadata.Notes = notes.map(quoted);
  metadata.Adopt = quoted(ADOPTION_HINT_CFN);
  const template: YamlMap = {
    AWSTemplateFormatVersion: quoted('2010-09-09'),
    Description: quoted(description),
    Metadata: {DynoTable: metadata},
    Resources: {
      [logicalId]: {
        Type: 'AWS::DynamoDB::GlobalTable',
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
        Properties: properties(spec)
      }
    }
  };
  return {template, logicalId};
}

export function renderCloudFormation(spec: TableSpec, opts: CloudFormationOptions): string {
  const {template, logicalId} = buildCloudFormationTemplate(spec);
  if (opts.syntax === 'json') return JSON.stringify(toJsonValue(template), null, 2) + '\n';
  const header = [
    `# dynamodb-table-iac: CloudFormation for DynamoDB table ${quoteForComment(spec.tableName)}`,
    `# Source: ${sourceDescription(spec)}`
  ];
  return header.join('\n') + '\n' + renderYaml(template, new Set([logicalId]));
}

export function emitCloudFormation(input: TableDefinitionInput, opts: CloudFormationOptions): EmitResult {
  const normalized = normalize(input);
  if (!normalized.ok) return normalized;
  return {ok: true, code: renderCloudFormation(normalized.spec, opts)};
}
