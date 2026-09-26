/**
 * Features every generated file lists as not emitted, with why. Rendered in
 * each file's header and on the dynotable.com tool page. Conditional facts
 * about ONE table (a dropped replica, an unknown TTL) are `TableSpec.notes`,
 * not this list.
 */
export const NOT_EMITTED: readonly string[] = [
  'point-in-time recovery (DescribeTable does not return it; applying a Terraform replica block disables it on that replica unless set)',
  'tags (DescribeTable does not return them; applying removes live tags)',
  'auto-scaling policies (a fixed capacity snapshot is emitted instead; applying replaces the policy with that snapshot)',
  'warm throughput (DescribeTable reports the CURRENT value, which grows with traffic; emitting it would bill a pre-warm)',
  'contributor insights, Kinesis streaming destinations and resource policies (DescribeTable does not return them)',
  'the KMS key ARN of an SSE-encrypted table (DescribeTable cannot tell an AWS-managed key from a customer-managed one; the AWS-managed key is emitted and the live ARN is left in a comment)',
  'settings of non-home replicas that DynamoDB never synchronizes (their deletion protection, PITR and tags are only visible from their own region)'
];
