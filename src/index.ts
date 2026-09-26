// Public API. Emitters read the AWS wire JSON (`DescribeTable` +
// `DescribeTimeToLive` output, PascalCase, as the CLI prints it) — never a
// DynoTable-shaped type — so the same input works for a paste into a browser
// and for a raw SDK response.
//
//   parseDescribeTableJson  — text → DescribeTable `.Table` (unwraps the CLI
//                             `{"Table": …}` envelope; validates nothing else)
//   emitTerraform / emitCdk / emitCloudFormation
//                           — TableDefinitionInput → runnable file, or a
//                             one-sentence refusal
//   NOT_EMITTED             — the features every header lists as not emitted

export type {
  AttributeDefinition,
  BillingMode,
  DescribeTableTable,
  EmitResult,
  GlobalSecondaryIndexDescription,
  GlobalTableWitnessDescription,
  IndexStatus,
  KeySchemaElement,
  KeyType,
  LocalSecondaryIndexDescription,
  MultiRegionConsistency,
  Projection,
  ProjectionType,
  ReplicaDescription,
  ScalarAttributeType,
  SSEDescription,
  StreamSpecification,
  StreamViewType,
  TableClass,
  TableDefinitionInput,
  TimeToLiveDescription,
  TimeToLiveStatus,
  VectorIndexDescription
} from './types';
export {parseDescribeTableJson} from './parse';
export type {ParseResult} from './parse';
