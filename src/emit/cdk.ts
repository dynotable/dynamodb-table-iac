import {quoteForComment, tsString} from '../escape';
import {pascalId} from '../names';
import {normalize, referencedAttributes} from '../normalize';
import type {GsiSpec, KeySpec, LsiSpec, ProjectionSpec, ReplicaSpec, TableSpec} from '../normalize';
import {NOT_EMITTED} from '../not-emitted';
import type {EmitResult, TableDefinitionInput} from '../types';
import {cfnAttributeDefinitions, cfnVectorIndex} from './cloudformation';
import {effectiveStreamView, headerNotes, sourceDescription} from './common';
import {Quoted} from './yaml';
import type {YamlNode} from './yaml';

// AWS CDK v2 (TypeScript) — `TableV2`, which synthesizes the same
// `AWS::DynamoDB::GlobalTable` the CloudFormation emitter writes, so the two
// outputs can be compared resource for resource (scripts/validate-cdk.ts does).
//
// Verified against aws-cdk-lib 2.271.0 source (aws-dynamodb/lib/table-v2.ts,
// billing.ts, capacity.ts, encryption.ts, 2026-09-26):
//   - `Billing.provisioned({readCapacity, writeCapacity})`: `writeCapacity`
//     MUST be `Capacity.autoscaled` (`Capacity.fixed` throws "cannot configure
//     'writeCapacity' with FIXED"); `autoscaled` defaults `minCapacity` 1 and
//     `targetUtilizationPercent` 70, so min = max = WCU renders exactly the
//     CFN emitter's `WriteCapacityAutoScalingSettings` (TargetValue 70).
//   - `GlobalSecondaryIndexPropsV2` takes `partitionKeys`/`sortKeys` arrays
//     (exactly one of singular/plural), so a multi-attribute GSI needs no L1
//     override. Under PAY_PER_REQUEST a GSI/replica `readCapacity` throws.
//   - `ReplicaTableProps`: `region`, `readCapacity`, `maxReadRequestUnits`,
//     `tableClass`, `globalSecondaryIndexOptions`, `deletionProtection`; an
//     unset replica `readCapacity`/`tableClass`/`deletionProtection` falls
//     back to the TABLE's (`configureReplicaTable`), which is why deletion
//     protection lands on every replica — an accepted divergence, stated in
//     the generated file's header.
//   - `renderStreamSpecification`: any replica forces NEW_AND_OLD_IMAGES when
//     `dynamoStream` is unset — the other stated divergence.
//   - `validateMrscConfiguration`: STRONG needs every region inside ONE set
//     (`CDK_MRSC_REGION_SETS`, copied verbatim); the service allows more.
//   - `TableEncryptionV2.awsManagedKey()` exists; `removalPolicy` defaults
//     RETAIN (set explicitly anyway). The L1 (`CfnGlobalTable`, service-spec
//     0.1.211) has no `VectorIndexes`, hence `addPropertyOverride`.

export const CDK_LIB_VERSION = '2.271';

const CDK_MRSC_REGION_SETS: Readonly<Record<string, readonly string[]>> = {
  US: ['us-east-1', 'us-east-2', 'us-west-2'],
  EU: ['eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1'],
  AP: ['ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3']
};

const ATTRIBUTE_TYPE = {S: 'STRING', N: 'NUMBER', B: 'BINARY'} as const;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const IND = '  ';

type Ctx = {spec: TableSpec; used: Set<string>};

/**
 * An object-literal key. A quoted OR bare `__proto__` key in a literal sets the
 * prototype instead of a property, so that one name is written computed.
 */
function key(name: string): string {
  if (name === '__proto__') return `[${tsString(name)}]`;
  return IDENTIFIER.test(name) ? name : tsString(name);
}

function use(ctx: Ctx, name: string): string {
  ctx.used.add(name);
  return name;
}

function attr(ctx: Ctx, name: string): string {
  const type = ctx.spec.attributeTypes.get(name);
  if (type === undefined) throw new Error(`attribute ${JSON.stringify(name)} has no definition`);
  return `{name: ${tsString(name)}, type: ${use(ctx, 'AttributeType')}.${ATTRIBUTE_TYPE[type]}}`;
}

/** `partitionKey`/`sortKey`, or the plural array form for a multi-attribute key. */
function keyProps(ctx: Ctx, keys: KeySpec[], pad: string): string[] {
  const hash = keys.filter((k) => k.type === 'HASH').map((k) => attr(ctx, k.name));
  const range = keys.filter((k) => k.type === 'RANGE').map((k) => attr(ctx, k.name));
  const lines = [
    hash.length === 1 ? `${pad}partitionKey: ${hash[0]},` : `${pad}partitionKeys: [${hash.join(', ')}],`
  ];
  if (range.length === 1) lines.push(`${pad}sortKey: ${range[0]},`);
  else if (range.length > 1) lines.push(`${pad}sortKeys: [${range.join(', ')}],`);
  return lines;
}

function projectionProps(ctx: Ctx, p: ProjectionSpec, pad: string): string[] {
  const lines = [`${pad}projectionType: ${use(ctx, 'ProjectionType')}.${p.type},`];
  if (p.type === 'INCLUDE') lines.push(`${pad}nonKeyAttributes: [${p.nonKeyAttributes.map(tsString).join(', ')}],`);
  return lines;
}

function fixed(ctx: Ctx, units: number): string {
  return `${use(ctx, 'Capacity')}.fixed(${units})`;
}

function autoscaled(ctx: Ctx, units: number): string {
  return `${use(ctx, 'Capacity')}.autoscaled({minCapacity: ${units}, maxCapacity: ${units}})`;
}

function billing(ctx: Ctx, pad: string): string[] {
  const b = ctx.spec.billing;
  const name = use(ctx, 'Billing');
  if (b.mode === 'PROVISIONED') {
    return [
      `${pad}billing: ${name}.provisioned({`,
      `${pad}${IND}readCapacity: ${fixed(ctx, b.throughput.read)},`,
      `${pad}${IND}writeCapacity: ${autoscaled(ctx, b.throughput.write)},`,
      `${pad}}),`
    ];
  }
  const max: string[] = [];
  if (b.max.maxRead !== undefined) max.push(`maxReadRequestUnits: ${b.max.maxRead}`);
  if (b.max.maxWrite !== undefined) max.push(`maxWriteRequestUnits: ${b.max.maxWrite}`);
  return [`${pad}billing: ${name}.onDemand(${max.length > 0 ? `{${max.join(', ')}}` : ''}),`];
}

function gsi(ctx: Ctx, g: GsiSpec, pad: string): string[] {
  const inner = pad + IND;
  const lines = [`${pad}{`, `${inner}indexName: ${tsString(g.name)},`, ...keyProps(ctx, g.keySchema, inner)];
  lines.push(...projectionProps(ctx, g.projection, inner));
  if (g.throughput) {
    lines.push(
      `${inner}readCapacity: ${fixed(ctx, g.throughput.read)},`,
      `${inner}writeCapacity: ${autoscaled(ctx, g.throughput.write)},`
    );
  }
  if (g.max?.maxRead !== undefined) lines.push(`${inner}maxReadRequestUnits: ${g.max.maxRead},`);
  if (g.max?.maxWrite !== undefined) lines.push(`${inner}maxWriteRequestUnits: ${g.max.maxWrite},`);
  lines.push(`${pad}},`);
  return lines;
}

function lsi(ctx: Ctx, l: LsiSpec, pad: string): string[] {
  const inner = pad + IND;
  const range = l.keySchema.find((k) => k.type === 'RANGE');
  if (range === undefined) throw new Error(`LSI ${JSON.stringify(l.name)} has no RANGE key`);
  return [
    `${pad}{`,
    `${inner}indexName: ${tsString(l.name)},`,
    `${inner}sortKey: ${attr(ctx, range.name)},`,
    ...projectionProps(ctx, l.projection, inner),
    `${pad}},`
  ];
}

/** A non-home replica. Only its OWN overrides are written: the L2 falls back to the table's values. */
function replica(ctx: Ctx, r: ReplicaSpec, pad: string): string[] {
  const provisioned = ctx.spec.billing.mode === 'PROVISIONED';
  const props: string[] = [`region: ${tsString(r.region)}`];
  // Only a class the L2 would not inherit from the table.
  if (r.tableClass !== undefined && r.tableClass !== (ctx.spec.tableClass ?? 'STANDARD')) {
    props.push(`tableClass: ${use(ctx, 'TableClass')}.${r.tableClass}`);
  }
  if (provisioned && r.readCapacity !== undefined) props.push(`readCapacity: ${fixed(ctx, r.readCapacity)}`);
  if (!provisioned && r.maxRead !== undefined) props.push(`maxReadRequestUnits: ${r.maxRead}`);
  const gsiOptions: string[] = [];
  for (const o of r.gsiOverrides) {
    if (provisioned && o.readCapacity !== undefined) {
      gsiOptions.push(`${key(o.name)}: {readCapacity: ${fixed(ctx, o.readCapacity)}}`);
    } else if (!provisioned && o.maxRead !== undefined) {
      gsiOptions.push(`${key(o.name)}: {maxReadRequestUnits: ${o.maxRead}}`);
    }
  }
  if (props.length === 1 && gsiOptions.length === 0) return [`${pad}{${props[0]}},`];
  const inner = pad + IND;
  const lines = [`${pad}{`, ...props.map((p) => `${inner}${p},`)];
  if (gsiOptions.length > 0) {
    lines.push(
      `${inner}globalSecondaryIndexOptions: {`,
      ...gsiOptions.map((o) => `${inner}${IND}${o},`),
      `${inner}},`
    );
  }
  lines.push(`${pad}},`);
  return lines;
}

function tableProps(ctx: Ctx, pad: string): string[] {
  const {spec} = ctx;
  const lines = [`${pad}tableName: ${tsString(spec.tableName)},`, ...keyProps(ctx, spec.keySchema, pad)];
  lines.push(...billing(ctx, pad));
  if (spec.gsis.length > 0) {
    lines.push(`${pad}globalSecondaryIndexes: [`, ...spec.gsis.flatMap((g) => gsi(ctx, g, pad + IND)), `${pad}],`);
  }
  if (spec.lsis.length > 0) {
    lines.push(`${pad}localSecondaryIndexes: [`, ...spec.lsis.flatMap((l) => lsi(ctx, l, pad + IND)), `${pad}],`);
  }
  if (spec.ttl.kind === 'enabled') lines.push(`${pad}timeToLiveAttribute: ${tsString(spec.ttl.attribute)},`);
  const stream = effectiveStreamView(spec);
  if (stream) lines.push(`${pad}dynamoStream: ${use(ctx, 'StreamViewType')}.${stream},`);
  if (spec.sse) {
    const enc = use(ctx, 'TableEncryptionV2');
    if (spec.sse.liveKeyArn) {
      lines.push(
        `${pad}// If the live key is customer-managed (DescribeTable cannot tell), replace this with`,
        `${pad}// ${enc}.customerManagedKey(Key.fromKeyArn(this, "TableKey", ${quoteForComment(spec.sse.liveKeyArn)}))`,
        `${pad}// with Key imported from "aws-cdk-lib/aws-kms".`
      );
    }
    lines.push(`${pad}encryption: ${enc}.awsManagedKey(),`);
  }
  if (spec.tableClass) lines.push(`${pad}tableClass: ${use(ctx, 'TableClass')}.${spec.tableClass},`);
  if (spec.deletionProtection) lines.push(`${pad}deletionProtection: true,`);
  if (spec.replicas.length > 0) {
    lines.push(`${pad}replicas: [`, ...spec.replicas.flatMap((r) => replica(ctx, r, pad + IND)), `${pad}],`);
  }
  if (spec.consistency === 'STRONG') {
    lines.push(`${pad}multiRegionConsistency: ${use(ctx, 'MultiRegionConsistency')}.STRONG,`);
  }
  if (spec.witnesses.length > 0) lines.push(`${pad}witnessRegion: ${tsString(spec.witnesses[0] as string)},`);
  lines.push(`${pad}removalPolicy: RemovalPolicy.RETAIN,`);
  return lines;
}

// --- L1 overrides for what the L2 cannot express (vector indexes) ---

function isScalarNode(node: YamlNode): node is Quoted | string | number | boolean {
  return node instanceof Quoted || typeof node !== 'object';
}

function tsScalar(node: Quoted | string | number | boolean): string {
  if (node instanceof Quoted) return tsString(node.value);
  if (typeof node === 'string') return tsString(node);
  return String(node);
}

/** A CFN property tree as a TS literal: all-scalar containers on one line, others one entry per line. */
function tsLiteral(node: YamlNode, indent: string): string {
  if (isScalarNode(node)) return tsScalar(node);
  const inner = indent + IND;
  if (Array.isArray(node)) {
    if (node.every(isScalarNode)) return `[${node.map(tsScalar).join(', ')}]`;
    return ['[', ...node.map((n) => `${inner}${tsLiteral(n, inner)},`), `${indent}]`].join('\n');
  }
  const entries = Object.entries(node);
  const oneLine = entries.map(([k, v]) => (isScalarNode(v) ? `${key(k)}: ${tsScalar(v)}` : undefined));
  if (oneLine.every((e) => e !== undefined)) return `{${oneLine.join(', ')}}`;
  return ['{', ...entries.map(([k, v]) => `${inner}${key(k)}: ${tsLiteral(v, inner)},`), `${indent}}`].join('\n');
}

function vectorOverrides(spec: TableSpec, pad: string): string[] {
  if (spec.vectorIndexes.length === 0) return [];
  const lines = [
    `${pad}// aws-cdk-lib ${CDK_LIB_VERSION} has no vector index support: the L1 is given the`,
    `${pad}// CloudFormation properties directly.`,
    `${pad}const cfnTable = table.node.defaultChild as CfnGlobalTable;`
  ];
  // The L2 derives AttributeDefinitions from key attributes only; a search
  // schema over a non-key attribute needs the full list.
  if (referencedAttributes(spec, {vectorIndexes: true}).length > referencedAttributes(spec, {vectorIndexes: false}).length) {
    lines.push(
      `${pad}cfnTable.addPropertyOverride("AttributeDefinitions", ${tsLiteral(cfnAttributeDefinitions(spec), pad)});`
    );
  }
  lines.push(
    `${pad}cfnTable.addPropertyOverride("VectorIndexes", ${tsLiteral(spec.vectorIndexes.map(cfnVectorIndex), pad)});`
  );
  return lines;
}

// --- header, refusals, assembly ---

function divergences(spec: TableSpec): string[] {
  const out: string[] = [];
  if (spec.replicas.length === 0) return out;
  if (spec.deletionProtection) {
    out.push(
      "TableV2 applies the table's deletion protection to every replica (the L2 has no per-replica off switch); the live replicas' own setting is not readable from the home region."
    );
  }
  if (spec.consistency === 'STRONG' && effectiveStreamView(spec) === undefined) {
    out.push('TableV2 attaches a NEW_AND_OLD_IMAGES stream to every global table; the live table has no stream.');
  }
  return out;
}

function header(spec: TableSpec): string[] {
  const lines = [
    `// dynamodb-table-iac: AWS CDK (TypeScript, aws-cdk-lib ${CDK_LIB_VERSION}) for DynamoDB table ${quoteForComment(spec.tableName)}`,
    `// Source: ${sourceDescription(spec)}`,
    '//',
    '// Not emitted (configure these yourself if the live table uses them):',
    ...NOT_EMITTED.map((item) => `//   - ${item}`)
  ];
  const notes = headerNotes(spec, {
    regionUnknown: "; the stack has no env.region and deploys to the CLI's default region.",
    provisioned:
      'Provisioned write capacity is emitted as Capacity.autoscaled with min = max = the current WCU (TableV2 refuses a fixed write capacity); the live scaling policy is not part of DescribeTable.'
  });
  if (notes.length > 0) lines.push('//', '// Notes:', ...notes.map((note) => `//   - ${note}`));
  const diverges = divergences(spec);
  if (diverges.length > 0) {
    lines.push('//', '// TableV2 cannot express the live table exactly:', ...diverges.map((d) => `//   - ${d}`));
  }
  lines.push(
    '//',
    '// To adopt the live table instead of creating a new one, run `cdk import` on',
    '// this stack and give it the table name when prompted; the table is retained',
    '// when the stack is deleted (RemovalPolicy.RETAIN).'
  );
  return lines;
}

/** Why `TableV2` cannot take this spec, or `undefined`. Every reason names another target that can. */
export function cdkRefusal(spec: TableSpec): string | undefined {
  if (spec.consistency !== 'STRONG' || spec.homeRegion === undefined) return undefined;
  const regions = [spec.homeRegion, ...spec.replicas.map((r) => r.region), ...spec.witnesses];
  const set = Object.values(CDK_MRSC_REGION_SETS).find((s) => s.includes(spec.homeRegion as string));
  if (set !== undefined && regions.every((r) => set.includes(r))) return undefined;
  const sets = Object.entries(CDK_MRSC_REGION_SETS)
    .map(([name, list]) => `${name} (${list.join(', ')})`)
    .join(', ');
  const span = regions.length === 1 ? regions[0] : `${regions.slice(0, -1).join(', ')} and ${regions.at(-1)}`;
  return `AWS CDK TableV2 (aws-cdk-lib ${CDK_LIB_VERSION}) accepts a strongly consistent global table only when every region is in one of its region sets — ${sets}; this table spans ${span}. Export it as Terraform or CloudFormation instead.`;
}

export function renderCdk(spec: TableSpec): string {
  const id = pascalId(spec.tableName);
  const stackClass = `${id}Stack`;
  const ctx: Ctx = {spec, used: new Set(['TableV2'])};
  const props = tableProps(ctx, IND.repeat(3));
  const overrides = vectorOverrides(spec, IND.repeat(2));
  const ddbImports = [...ctx.used].sort();

  const lines = [
    ...header(spec),
    '',
    'import {App, RemovalPolicy, Stack} from "aws-cdk-lib";',
    'import type {StackProps} from "aws-cdk-lib";',
    `import {${ddbImports.join(', ')}} from "aws-cdk-lib/aws-dynamodb";`
  ];
  if (overrides.length > 0) lines.push('import type {CfnGlobalTable} from "aws-cdk-lib/aws-dynamodb";');
  lines.push(
    'import type {Construct} from "constructs";',
    '',
    `export class ${stackClass} extends Stack {`,
    `${IND}constructor(scope: Construct, id: string, props?: StackProps) {`,
    `${IND}${IND}super(scope, id, props);`,
    '',
    `${IND}${IND}${overrides.length > 0 ? 'const table = ' : ''}new TableV2(this, ${tsString(id)}, {`,
    ...props,
    `${IND}${IND}});`
  );
  if (overrides.length > 0) lines.push('', ...overrides);
  const env = spec.homeRegion === undefined ? '' : `, {env: {region: ${tsString(spec.homeRegion)}}}`;
  lines.push(
    `${IND}}`,
    '}',
    '',
    'const app = new App();',
    `new ${stackClass}(app, ${tsString(stackClass)}${env});`
  );
  return lines.join('\n') + '\n';
}

export function emitCdk(input: TableDefinitionInput): EmitResult {
  const normalized = normalize(input);
  if (!normalized.ok) return normalized;
  const refusal = cdkRefusal(normalized.spec);
  if (refusal !== undefined) return {ok: false, reason: refusal};
  return {ok: true, code: renderCdk(normalized.spec)};
}
