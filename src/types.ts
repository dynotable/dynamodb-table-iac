// Structural subset of the AWS DynamoDB wire shapes this package reads, as
// `aws dynamodb describe-table` / `describe-time-to-live` print them
// (PascalCase). Declared locally so the package has zero dependencies and
// accepts both a CLI paste and a raw SDK response.
//
// Only fields `normalize()` reads are typed. Read-only facts DescribeTable
// returns beside them (statuses other than index/replica status, counts,
// sizes, ARNs other than TableArn/ReplicaArn, timestamps, warm throughput)
// are deliberately `unknown` or absent: nothing here reads them, so a paste
// carrying a timestamp as an ISO string, an epoch number or a Date all parse
// alike.

export type KeyType = 'HASH' | 'RANGE';
export type ScalarAttributeType = 'S' | 'N' | 'B';
export type ProjectionType = 'ALL' | 'KEYS_ONLY' | 'INCLUDE';
export type BillingMode = 'PROVISIONED' | 'PAY_PER_REQUEST';
export type StreamViewType = 'NEW_IMAGE' | 'OLD_IMAGE' | 'NEW_AND_OLD_IMAGES' | 'KEYS_ONLY';
export type TableClass = 'STANDARD' | 'STANDARD_INFREQUENT_ACCESS';
export type IndexStatus = 'CREATING' | 'UPDATING' | 'DELETING' | 'ACTIVE';
export type VectorDistanceFunction = 'COSINE' | 'DOT_PRODUCT' | 'EUCLIDEAN';
export type SearchSchemaElementType = 'HASH' | 'INLINE_FILTER';
export type MultiRegionConsistency = 'EVENTUAL' | 'STRONG';
export type TimeToLiveStatus = 'ENABLING' | 'DISABLING' | 'ENABLED' | 'DISABLED';
export type SSEType = 'AES256' | 'KMS';
export type SSEStatus = 'ENABLING' | 'ENABLED' | 'DISABLING' | 'DISABLED' | 'UPDATING';

export interface KeySchemaElement {
  AttributeName?: string;
  KeyType?: KeyType | string;
}

export interface AttributeDefinition {
  AttributeName?: string;
  AttributeType?: ScalarAttributeType | string;
}

export interface Projection {
  ProjectionType?: ProjectionType | string;
  NonKeyAttributes?: string[];
}

export interface ProvisionedThroughputDescription {
  ReadCapacityUnits?: number;
  WriteCapacityUnits?: number;
  LastIncreaseDateTime?: unknown;
  LastDecreaseDateTime?: unknown;
  NumberOfDecreasesToday?: unknown;
}

export interface OnDemandThroughput {
  MaxReadRequestUnits?: number;
  MaxWriteRequestUnits?: number;
}

export interface OnDemandThroughputOverride {
  MaxReadRequestUnits?: number;
}

export interface ProvisionedThroughputOverride {
  ReadCapacityUnits?: number;
}

export interface BillingModeSummary {
  BillingMode?: BillingMode | string;
  LastUpdateToPayPerRequestDateTime?: unknown;
}

export interface StreamSpecification {
  StreamEnabled?: boolean;
  StreamViewType?: StreamViewType | string;
}

export interface SSEDescription {
  Status?: SSEStatus | string;
  SSEType?: SSEType | string;
  KMSMasterKeyArn?: string;
  InaccessibleEncryptionDateTime?: unknown;
}

export interface TableClassSummary {
  TableClass?: TableClass | string;
  LastUpdateDateTime?: unknown;
}

export interface GlobalSecondaryIndexDescription {
  IndexName?: string;
  KeySchema?: KeySchemaElement[];
  Projection?: Projection;
  IndexStatus?: IndexStatus | string;
  Backfilling?: boolean;
  ProvisionedThroughput?: ProvisionedThroughputDescription;
  OnDemandThroughput?: OnDemandThroughput;
  IndexSizeBytes?: unknown;
  ItemCount?: unknown;
  IndexArn?: unknown;
  WarmThroughput?: unknown;
}

export interface LocalSecondaryIndexDescription {
  IndexName?: string;
  KeySchema?: KeySchemaElement[];
  Projection?: Projection;
  IndexSizeBytes?: unknown;
  ItemCount?: unknown;
  IndexArn?: unknown;
}

export interface VectorAttributeDefinition {
  AttributeName?: string;
}

export interface SearchSchemaElement {
  AttributeName?: string;
  SearchSchemaElementType?: SearchSchemaElementType | string;
}

export interface VectorIndexDescription {
  IndexName?: string;
  SearchSchema?: SearchSchemaElement[];
  Projection?: Projection;
  VectorAttribute?: VectorAttributeDefinition;
  Dimensions?: number;
  DistanceFunction?: VectorDistanceFunction | string;
  IndexStatus?: IndexStatus | string;
  Backfilling?: boolean;
  IndexSizeBytes?: unknown;
  ItemCount?: unknown;
  IndexArn?: unknown;
}

export interface ReplicaGlobalSecondaryIndexDescription {
  IndexName?: string;
  ProvisionedThroughputOverride?: ProvisionedThroughputOverride;
  OnDemandThroughputOverride?: OnDemandThroughputOverride;
  WarmThroughput?: unknown;
}

export interface ReplicaDescription {
  RegionName?: string;
  ReplicaStatus?: string;
  ReplicaArn?: string;
  ReplicaStatusDescription?: string;
  ReplicaStatusPercentProgress?: string;
  KMSMasterKeyId?: string;
  ProvisionedThroughputOverride?: ProvisionedThroughputOverride;
  OnDemandThroughputOverride?: OnDemandThroughputOverride;
  GlobalSecondaryIndexes?: ReplicaGlobalSecondaryIndexDescription[];
  ReplicaTableClassSummary?: TableClassSummary;
  WarmThroughput?: unknown;
  ReplicaInaccessibleDateTime?: unknown;
  GlobalTableSettingsReplicationMode?: unknown;
}

export interface GlobalTableWitnessDescription {
  RegionName?: string;
  WitnessStatus?: string;
}

/** `DescribeTable` output `.Table`. */
export interface DescribeTableTable {
  TableName?: string;
  TableArn?: string;
  KeySchema?: KeySchemaElement[];
  AttributeDefinitions?: AttributeDefinition[];
  BillingModeSummary?: BillingModeSummary;
  ProvisionedThroughput?: ProvisionedThroughputDescription;
  OnDemandThroughput?: OnDemandThroughput;
  GlobalSecondaryIndexes?: GlobalSecondaryIndexDescription[];
  LocalSecondaryIndexes?: LocalSecondaryIndexDescription[];
  VectorIndexes?: VectorIndexDescription[];
  StreamSpecification?: StreamSpecification;
  SSEDescription?: SSEDescription;
  TableClassSummary?: TableClassSummary;
  DeletionProtectionEnabled?: boolean;
  Replicas?: ReplicaDescription[];
  GlobalTableWitnesses?: GlobalTableWitnessDescription[];
  MultiRegionConsistency?: MultiRegionConsistency | string;
  GlobalTableVersion?: string;
  TableStatus?: unknown;
  TableId?: unknown;
  CreationDateTime?: unknown;
  TableSizeBytes?: unknown;
  ItemCount?: unknown;
  LatestStreamLabel?: unknown;
  LatestStreamArn?: unknown;
  WarmThroughput?: unknown;
  RestoreSummary?: unknown;
  ArchivalSummary?: unknown;
  GlobalTableSettingsReplicationMode?: unknown;
}

/** `DescribeTimeToLive` output `.TimeToLiveDescription`. */
export interface TimeToLiveDescription {
  TimeToLiveStatus?: TimeToLiveStatus | string;
  AttributeName?: string;
}

export interface TableDefinitionInput {
  table: DescribeTableTable;
  /**
   * `undefined` = the caller did not run `describe-time-to-live`; `null` = it
   * ran and failed (the header then says TTL is unknown rather than absent).
   */
  timeToLive?: TimeToLiveDescription | null;
  /**
   * The region the describe ran against. `TableArn` carries the same fact for
   * real tables; this is the fallback for DynamoDB Local, whose ARN region is
   * the literal `ddblocal`.
   */
  region?: string;
}

export type EmitResult = {ok: true; code: string} | {ok: false; reason: string};
