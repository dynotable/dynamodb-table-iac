import {pascalId} from '../names';
import {normalize, referencedAttributes} from '../normalize';
import type {GsiSpec, KeySpec, ProjectionSpec, ReplicaSpec, TableSpec, VectorIndexSpec} from '../normalize';
import {NOT_EMITTED} from '../not-emitted';
import type {EmitResult, TableDefinitionInput} from '../types';
import {ADOPTION_HINT_CFN, REGION_UNKNOWN_PREFIX, sourceDescription} from './common';
import {q, renderYaml, toJsonValue} from './yaml';
import type {YamlMap, YamlNode} from './yaml';

// CloudFormation `AWS::DynamoDB::GlobalTable` — always, single-region tables
// included (one replica = the home region): the same resource type the CDK
// output synthesizes, so the two can be compared resource for resource.
// GlobalTable expresses provisioned WRITE capacity only as auto-scaling, so a
// provisioned table gets min = max = its current WCU; READ capacity is per
// replica (and per replica GSI); TableClass and DeletionProtectionEnabled are
// per replica too.

const TARGET_UTILIZATION = 70;
const DESCRIPTION_LIMIT = 1024;

export type CloudFormationSyntax = 'yaml' | 'json';

export interface CloudFormationOptions {
  syntax: CloudFormationSyntax;
}

function keySchema(keys: KeySpec[]): YamlNode[] {
  return keys.map((k) => ({AttributeName: q(k.name), KeyType: k.type}));
}

function projection(p: ProjectionSpec): YamlMap {
  const node: YamlMap = {ProjectionType: p.type};
  if (p.type === 'INCLUDE') node.NonKeyAttributes = p.nonKeyAttributes.map(q);
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

function gsi(spec: TableSpec, g: GsiSpec): YamlMap {
  const node: YamlMap = {IndexName: q(g.name), KeySchema: keySchema(g.keySchema), Projection: projection(g.projection)};
  if (spec.billing.mode === 'PROVISIONED' && g.throughput) {
    node.WriteProvisionedThroughputSettings = writeAutoScaling(g.throughput.write);
  } else if (g.max?.maxWrite !== undefined) {
    node.WriteOnDemandThroughputSettings = {MaxWriteRequestUnits: g.max.maxWrite};
  }
  return node;
}

function vectorIndex(v: VectorIndexSpec): YamlMap {
  const node: YamlMap = {
    IndexName: q(v.name),
    VectorAttribute: {AttributeName: q(v.attribute)},
    Dimensions: v.dimensions,
    DistanceFunction: v.distanceFunction,
    Projection: projection(v.projection)
  };
  if (v.searchSchema.length > 0) {
    node.SearchSchema = v.searchSchema.map((el) => ({AttributeName: q(el.name), SearchSchemaElementType: el.type}));
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
  const tableClass = override?.tableClass ?? spec.tableClass;
  if (tableClass) node.TableClass = tableClass;

  if (spec.billing.mode === 'PROVISIONED') {
    node.ReadProvisionedThroughputSettings = {
      ReadCapacityUnits: override?.readCapacity ?? spec.billing.throughput.read
    };
    const indexes = spec.gsis.map((g) => ({
      IndexName: q(g.name),
      ReadProvisionedThroughputSettings: {
        ReadCapacityUnits:
          override?.gsiOverrides.find((o) => o.name === g.name)?.readCapacity ?? g.throughput?.read ?? 0
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
        indexes.push({IndexName: q(g.name), ReadOnDemandThroughputSettings: {MaxReadRequestUnits: gsiMax}});
      }
    }
    if (indexes.length > 0) node.GlobalSecondaryIndexes = indexes;
  }
  return node;
}

function properties(spec: TableSpec): YamlMap {
  const props: YamlMap = {
    TableName: q(spec.tableName),
    BillingMode: spec.billing.mode,
    AttributeDefinitions: referencedAttributes(spec, {vectorIndexes: true}).map((a) => ({
      AttributeName: q(a.name),
      // Quoted: a bare `N` is a YAML 1.1 boolean word (y|Y|n|N), and the CloudFormation
      // parser is YAML 1.1.
      AttributeType: q(a.type)
    })),
    KeySchema: keySchema(spec.keySchema)
  };
  if (spec.gsis.length > 0) props.GlobalSecondaryIndexes = spec.gsis.map((g) => gsi(spec, g));
  if (spec.lsis.length > 0) {
    props.LocalSecondaryIndexes = spec.lsis.map((l) => ({
      IndexName: q(l.name),
      KeySchema: keySchema(l.keySchema),
      Projection: projection(l.projection)
    }));
  }
  if (spec.vectorIndexes.length > 0) props.VectorIndexes = spec.vectorIndexes.map(vectorIndex);
  if (spec.ttl.kind === 'enabled') {
    props.TimeToLiveSpecification = {AttributeName: q(spec.ttl.attribute), Enabled: true};
  }
  // EVENTUAL replication rides the stream, so more than one replica needs one;
  // a STRONG table needs none and keeps whatever it has live.
  const streamView =
    spec.replicas.length > 0 && spec.consistency === 'EVENTUAL' ? 'NEW_AND_OLD_IMAGES' : spec.stream;
  if (streamView) props.StreamSpecification = {StreamViewType: streamView};
  if (spec.sse) props.SSESpecification = {SSEEnabled: true, SSEType: 'KMS'};
  if (spec.billing.mode === 'PROVISIONED') {
    props.WriteProvisionedThroughputSettings = writeAutoScaling(spec.billing.throughput.write);
  } else if (spec.billing.max.maxWrite !== undefined) {
    props.WriteOnDemandThroughputSettings = {MaxWriteRequestUnits: spec.billing.max.maxWrite};
  }
  if (spec.consistency === 'STRONG') props.MultiRegionConsistency = 'STRONG';
  if (spec.witnesses.length > 0) props.GlobalTableWitnesses = spec.witnesses.map((w) => ({Region: w}));

  const home: YamlNode = spec.homeRegion ?? {Ref: q('AWS::Region')};
  props.Replicas = [replica(spec, home, undefined), ...spec.replicas.map((r) => replica(spec, r.region, r))];
  return props;
}

function notesFor(spec: TableSpec): string[] {
  const notes = [...spec.notes];
  if (spec.homeRegion === undefined) {
    notes.unshift(`${REGION_UNKNOWN_PREFIX}; the home replica is the stack's own region (Ref AWS::Region).`);
  }
  if (spec.billing.mode === 'PROVISIONED') {
    notes.push(
      'Provisioned write capacity is emitted as write auto-scaling with min = max = the current WCU (AWS::DynamoDB::GlobalTable accepts no fixed write capacity); the live scaling policy is not part of DescribeTable.'
    );
  }
  return notes;
}

export function buildCloudFormationTemplate(spec: TableSpec): {template: YamlMap; logicalId: string} {
  const logicalId = pascalId(spec.tableName);
  const description = `DynamoDB table ${spec.tableName}, generated by dynamodb-table-iac from describe-table output`;
  if (description.length > DESCRIPTION_LIMIT) throw new Error('CloudFormation Description exceeds 1024 bytes');
  const metadata: YamlMap = {
    Source: q(sourceDescription(spec)),
    NotEmitted: NOT_EMITTED.map(q)
  };
  const notes = notesFor(spec);
  if (notes.length > 0) metadata.Notes = notes.map(q);
  metadata.Adopt = q(ADOPTION_HINT_CFN);
  const template: YamlMap = {
    AWSTemplateFormatVersion: q('2010-09-09'),
    Description: q(description),
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
    `# dynamodb-table-iac: CloudFormation for DynamoDB table ${JSON.stringify(spec.tableName)}`,
    `# Source: ${sourceDescription(spec)}`
  ];
  return header.join('\n') + '\n' + renderYaml(template, new Set([logicalId]));
}

export function emitCloudFormation(input: TableDefinitionInput, opts: CloudFormationOptions): EmitResult {
  const normalized = normalize(input);
  if (!normalized.ok) return normalized;
  return {ok: true, code: renderCloudFormation(normalized.spec, opts)};
}
