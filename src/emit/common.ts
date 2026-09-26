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

/**
 * The stream view every target writes: EVENTUAL replication rides a
 * NEW_AND_OLD_IMAGES stream, so more than one replica needs one; a STRONG table
 * needs none and keeps whatever it has live.
 */
export function effectiveStreamView(spec: TableSpec): TableSpec['stream'] {
  return spec.replicas.length > 0 && spec.consistency === 'EVENTUAL' ? 'NEW_AND_OLD_IMAGES' : spec.stream;
}

/**
 * Header notes in the order every target prints them: the region-unknown note
 * first (with the target's own tail), the table's notes, then the target's
 * provisioned-capacity note when it has one.
 */
export function headerNotes(spec: TableSpec, tails: {regionUnknown: string; provisioned?: string}): string[] {
  const notes = [...spec.notes];
  if (spec.homeRegion === undefined) notes.unshift(`${REGION_UNKNOWN_PREFIX}${tails.regionUnknown}`);
  if (tails.provisioned !== undefined && spec.billing.mode === 'PROVISIONED') notes.push(tails.provisioned);
  return notes;
}
