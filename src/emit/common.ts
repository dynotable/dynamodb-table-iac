import type {TableSpec} from '../normalize';

// Header facts shared by every emitter, so the three files say the same thing
// about the same table.

/** `describe-time-to-live` is named only when the caller actually provided it. */
export function sourceDescription(spec: TableSpec): string {
  const source =
    spec.ttl.kind === 'not-provided'
      ? 'aws dynamodb describe-table'
      : 'aws dynamodb describe-table + describe-time-to-live';
  return `${source}, region ${spec.homeRegion ?? 'unknown'}`;
}

export const REGION_UNKNOWN_PREFIX =
  "Region: unknown — the table's ARN carries no AWS region (DynamoDB Local) and none was given";

export const ADOPTION_HINT_CFN =
  'To adopt the live table instead of creating a new one, bring it into a stack with resource import (aws cloudformation create-stack --import-existing-resources, or an IMPORT change set); DeletionPolicy Retain is set, as import requires.';
