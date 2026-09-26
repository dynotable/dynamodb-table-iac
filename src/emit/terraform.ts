import {hclString, quoteForComment} from '../escape';
import {terraformId} from '../names';
import {normalize, referencedAttributes} from '../normalize';
import type {GsiSpec, ReplicaSpec, TableSpec, VectorIndexSpec} from '../normalize';
import {NOT_EMITTED} from '../not-emitted';
import type {EmitResult, TableDefinitionInput} from '../types';
import {REGION_UNKNOWN_PREFIX, sourceDescription} from './common';

// Terraform `aws_dynamodb_table` (hashicorp/aws >= 6.29 — GSI keys as repeated
// `key_schema` blocks, which the provider deprecated `hash_key`/`range_key`
// for). Output is `terraform fmt`-clean by construction: consecutive attribute
// lines are aligned on `=` exactly as fmt aligns them, blocks are separated by
// one blank line.

const PROVIDER_CONSTRAINT = '~> 6.29';
const PROVIDER_MAJOR_FOR_VECTORS = 'v6.66';

type Attr = [name: string, literal: string];

function q(value: string): string {
  return quoteForComment(value);
}

/** Aligned `name = literal` lines, the way `terraform fmt` lays out a run of attributes. */
function attrLines(attrs: Attr[], indent: string): string[] {
  const width = Math.max(...attrs.map(([name]) => name.length));
  return attrs.map(([name, literal]) => `${indent}${name.padEnd(width)} = ${literal}`);
}

function block(name: string, body: string[], indent: string): string[] {
  return [`${indent}${name} {`, ...body, `${indent}}`];
}

function joinBlocks(blocks: string[][]): string[] {
  const out: string[] = [];
  blocks.forEach((b, i) => {
    if (i > 0) out.push('');
    out.push(...b);
  });
  return out;
}

function header(spec: TableSpec, resourceId: string): string[] {
  const lines = [
    `# dynamodb-table-iac: Terraform for DynamoDB table ${q(spec.tableName)}`,
    `# Source: ${sourceDescription(spec)}`,
    '#',
    '# Not emitted (configure these yourself if the live table uses them):',
    ...NOT_EMITTED.map((item) => `#   - ${item}`)
  ];
  const notes = [...spec.notes];
  if (spec.homeRegion === undefined) {
    notes.unshift(`${REGION_UNKNOWN_PREFIX}, so no provider region is emitted; add one before applying.`);
  }
  if (notes.length > 0) {
    lines.push('#', '# Notes:', ...notes.map((note) => `#   - ${note}`));
  }
  lines.push(
    '#',
    '# To adopt the live table instead of creating a new one, uncomment this import',
    '# block, then run `terraform plan` and check that it reports no changes:',
    '# import {',
    `#   to = aws_dynamodb_table.${resourceId}`,
    `#   id = ${hclString(spec.tableName)}`,
    '# }'
  );
  return lines;
}

function topLevelAttrs(spec: TableSpec, streamView: TableSpec['stream']): Attr[] {
  const attrs: Attr[] = [
    ['name', hclString(spec.tableName)],
    ['billing_mode', hclString(spec.billing.mode)],
    ['hash_key', hclString(spec.keySchema[0]?.name ?? '')]
  ];
  const range = spec.keySchema.find((k) => k.type === 'RANGE');
  if (range) attrs.push(['range_key', hclString(range.name)]);
  if (spec.billing.mode === 'PROVISIONED') {
    attrs.push(
      ['read_capacity', String(spec.billing.throughput.read)],
      ['write_capacity', String(spec.billing.throughput.write)]
    );
  }
  if (streamView) attrs.push(['stream_enabled', 'true'], ['stream_view_type', hclString(streamView)]);
  if (spec.tableClass) attrs.push(['table_class', hclString(spec.tableClass)]);
  if (spec.deletionProtection) attrs.push(['deletion_protection_enabled', 'true']);
  return attrs;
}

function keySchemaBlocks(keys: GsiSpec['keySchema'], indent: string): string[][] {
  return keys.map((k) =>
    block('key_schema', attrLines([['attribute_name', hclString(k.name)], ['key_type', hclString(k.type)]], `${indent}  `), indent)
  );
}

function onDemandBlock(max: {maxRead?: number; maxWrite?: number}, indent: string): string[][] {
  const attrs: Attr[] = [];
  if (max.maxRead !== undefined) attrs.push(['max_read_request_units', String(max.maxRead)]);
  if (max.maxWrite !== undefined) attrs.push(['max_write_request_units', String(max.maxWrite)]);
  return attrs.length === 0 ? [] : [block('on_demand_throughput', attrLines(attrs, `${indent}  `), indent)];
}

function gsiBlock(gsi: GsiSpec, indent: string): string[] {
  const inner = `${indent}  `;
  const attrs: Attr[] = [
    ['name', hclString(gsi.name)],
    ['projection_type', hclString(gsi.projection.type)]
  ];
  if (gsi.projection.type === 'INCLUDE') {
    attrs.push(['non_key_attributes', `[${gsi.projection.nonKeyAttributes.map(hclString).join(', ')}]`]);
  }
  if (gsi.throughput) {
    attrs.push(['read_capacity', String(gsi.throughput.read)], ['write_capacity', String(gsi.throughput.write)]);
  }
  const body = joinBlocks([
    attrLines(attrs, inner),
    ...keySchemaBlocks(gsi.keySchema, inner),
    ...onDemandBlock(gsi.max ?? {}, inner)
  ]);
  return block('global_secondary_index', body, indent);
}

function lsiBlock(lsi: TableSpec['lsis'][number], indent: string): string[] {
  const attrs: Attr[] = [
    ['name', hclString(lsi.name)],
    ['range_key', hclString(lsi.keySchema[1]?.name ?? '')],
    ['projection_type', hclString(lsi.projection.type)]
  ];
  if (lsi.projection.type === 'INCLUDE') {
    attrs.push(['non_key_attributes', `[${lsi.projection.nonKeyAttributes.map(hclString).join(', ')}]`]);
  }
  return block('local_secondary_index', attrLines(attrs, `${indent}  `), indent);
}

function sseBlock(spec: TableSpec, indent: string): string[][] {
  if (!spec.sse) return [];
  const inner = `${indent}  `;
  const body = [`${inner}enabled = true`];
  if (spec.sse.liveKeyArn) {
    body.push(
      `${inner}# Uncomment if the live key is customer-managed (DescribeTable cannot tell):`,
      `${inner}# kms_key_arn = ${hclString(spec.sse.liveKeyArn)}`
    );
  }
  return [block('server_side_encryption', body, indent)];
}

/** The replica block has no per-replica capacity/class arguments; say what was on the live replica. */
function replicaOverrideNote(r: ReplicaSpec): string | undefined {
  const parts: string[] = [];
  if (r.tableClass) parts.push(`table class ${r.tableClass}`);
  if (r.readCapacity !== undefined) parts.push(`read capacity ${r.readCapacity}`);
  if (r.maxRead !== undefined) parts.push(`on-demand max read ${r.maxRead}`);
  for (const g of r.gsiOverrides) {
    if (g.readCapacity !== undefined) parts.push(`index ${q(g.name)} read capacity ${g.readCapacity}`);
    if (g.maxRead !== undefined) parts.push(`index ${q(g.name)} on-demand max read ${g.maxRead}`);
  }
  if (parts.length === 0) return undefined;
  return `# NOT EMITTED: replica ${r.region} overrides — ${parts.join(', ')} (the replica block has no such arguments).`;
}

function replicaBlocks(spec: TableSpec, indent: string): string[][] {
  if (spec.replicas.length === 0 && spec.witnesses.length === 0) return [];
  const inner = `${indent}  `;
  const blocks: string[][] = [];
  const preamble = [
    `${indent}# Replica blocks default point_in_time_recovery, deletion_protection_enabled and`,
    `${indent}# propagate_tags to false: applying this file turns them off on the replicas`,
    `${indent}# below unless you set them here.`
  ];
  spec.replicas.forEach((r, i) => {
    const attrs: Attr[] = [['region_name', hclString(r.region)]];
    if (spec.consistency === 'STRONG') attrs.push(['consistency_mode', hclString('STRONG')]);
    const body = attrLines(attrs, inner);
    if (r.kmsKeyId) {
      body.push(
        `${inner}# Uncomment if the live key is customer-managed (DescribeTable cannot tell):`,
        `${inner}# kms_key_arn = ${hclString(r.kmsKeyId)}`
      );
    }
    const lead = i === 0 ? [...preamble] : [];
    const note = replicaOverrideNote(r);
    if (note) lead.push(`${indent}${note}`);
    blocks.push([...lead, ...block('replica', body, indent)]);
  });
  for (const w of spec.witnesses) {
    blocks.push(block('global_table_witness', [`${inner}region_name = ${hclString(w)}`], indent));
  }
  return blocks;
}

function lifecycleBlock(spec: TableSpec, indent: string): string[][] {
  if (spec.billing.mode !== 'PROVISIONED' || spec.replicas.length === 0) return [];
  return [
    [
      `${indent}# Replicas of a provisioned global table are normally auto-scaled; keep Terraform`,
      `${indent}# from fighting the scaling policy over the capacity snapshot above.`,
      ...block('lifecycle', [`${indent}  ignore_changes = [read_capacity, write_capacity]`], indent)
    ]
  ];
}

function vectorComment(indexes: VectorIndexSpec[], indent: string): string[][] {
  if (indexes.length === 0) return [];
  const lines = [
    `${indent}# NOT EMITTED: the Terraform AWS provider (${PROVIDER_MAJOR_FOR_VECTORS}) has no DynamoDB vector index support.`
  ];
  for (const v of indexes) {
    lines.push(
      `${indent}# Vector index ${q(v.name)}: vector attribute ${q(v.attribute)}, ${v.dimensions} dimensions, ${v.distanceFunction} distance, projection ${v.projection.type}`
    );
    if (v.searchSchema.length > 0) {
      lines.push(`${indent}#   search schema: ${v.searchSchema.map((el) => `${q(el.name)} ${el.type}`).join(', ')}`);
    }
  }
  return [lines];
}

export function renderTerraform(spec: TableSpec): string {
  const resourceId = terraformId(spec.tableName);
  // EVENTUAL global tables replicate over the stream, so one is required; a
  // STRONG table needs none and keeps whatever it has live.
  const streamView =
    spec.replicas.length > 0 && spec.consistency === 'EVENTUAL' ? 'NEW_AND_OLD_IMAGES' : spec.stream;
  const indent = '  ';

  const resourceBody = joinBlocks([
    attrLines(topLevelAttrs(spec, streamView), indent),
    ...referencedAttributes(spec, {vectorIndexes: false}).map((a) =>
      block('attribute', attrLines([['name', hclString(a.name)], ['type', hclString(a.type)]], `${indent}  `), indent)
    ),
    ...spec.gsis.map((g) => gsiBlock(g, indent)),
    ...spec.lsis.map((l) => lsiBlock(l, indent)),
    ...(spec.billing.mode === 'PAY_PER_REQUEST' ? onDemandBlock(spec.billing.max, indent) : []),
    ...sseBlock(spec, indent),
    ...(spec.ttl.kind === 'enabled'
      ? [block('ttl', attrLines([['attribute_name', hclString(spec.ttl.attribute)], ['enabled', 'true']], `${indent}  `), indent)]
      : []),
    ...replicaBlocks(spec, indent),
    ...lifecycleBlock(spec, indent),
    ...vectorComment(spec.vectorIndexes, indent)
  ]);

  const terraformBlock = block(
    'terraform',
    block(
      'required_providers',
      block('aws', attrLines([['source', hclString('hashicorp/aws')], ['version', hclString(PROVIDER_CONSTRAINT)]], '      '), '    ').map(
        (l, i) => (i === 0 ? '    aws = {' : l)
      ),
      '  '
    ),
    ''
  );
  const providerBlock =
    spec.homeRegion === undefined ? [] : block('provider "aws"', [`  region = ${hclString(spec.homeRegion)}`], '');

  const sections: string[][] = [header(spec, resourceId), terraformBlock];
  if (providerBlock.length > 0) sections.push(providerBlock);
  sections.push(block(`resource "aws_dynamodb_table" "${resourceId}"`, resourceBody, ''));
  return joinBlocks(sections).join('\n') + '\n';
}

export function emitTerraform(input: TableDefinitionInput): EmitResult {
  const normalized = normalize(input);
  if (!normalized.ok) return normalized;
  return {ok: true, code: renderTerraform(normalized.spec)};
}
