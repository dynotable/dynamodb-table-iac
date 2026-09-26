// dynamodb-table-iac: AWS CDK (TypeScript, aws-cdk-lib 2.271) for DynamoDB table "audit-log"
// Source: aws dynamodb describe-table, region eu-west-1
//
// Not emitted (configure these yourself if the live table uses them):
//   - point-in-time recovery (DescribeTable does not return it; a replica declared without it has PITR off)
//   - tags (DescribeTable does not return them; applying removes live tags)
//   - auto-scaling policies (a fixed capacity snapshot is emitted instead; applying replaces the policy with that snapshot)
//   - warm throughput (DescribeTable reports the CURRENT value, which grows with traffic; emitting it would bill a pre-warm)
//   - contributor insights, Kinesis streaming destinations and resource policies (DescribeTable does not return them)
//   - the KMS key ARN of an SSE-encrypted table (DescribeTable cannot tell an AWS-managed key from a customer-managed one; the AWS-managed key is emitted and the live ARN is left in a comment)
//   - settings of non-home replicas that DynamoDB never synchronizes (their deletion protection, PITR and tags are only visible from their own region)
//
// Notes:
//   - SSE uses KMS key "arn:aws:kms:eu-west-1:123456789012:key/1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b" — if that is a customer-managed key, set it on the emitted encryption setting.
//   - TTL: not provided — include the output of `aws dynamodb describe-time-to-live` to add it.
//
// To adopt the live table instead of creating a new one, run `cdk import` on
// this stack and give it the table name when prompted; the table is retained
// when the stack is deleted (RemovalPolicy.RETAIN).

import {App, RemovalPolicy, Stack} from "aws-cdk-lib";
import type {StackProps} from "aws-cdk-lib";
import {AttributeType, Billing, TableClass, TableEncryptionV2, TableV2} from "aws-cdk-lib/aws-dynamodb";
import type {Construct} from "constructs";

export class AuditLogStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new TableV2(this, "AuditLog", {
      tableName: "audit-log",
      partitionKey: {name: "pk", type: AttributeType.STRING},
      billing: Billing.onDemand({maxReadRequestUnits: 2000}),
      // If the live key is customer-managed (DescribeTable cannot tell), replace this with
      // TableEncryptionV2.customerManagedKey(Key.fromKeyArn(this, "TableKey", "arn:aws:kms:eu-west-1:123456789012:key/1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b"))
      // with Key imported from "aws-cdk-lib/aws-kms".
      encryption: TableEncryptionV2.awsManagedKey(),
      tableClass: TableClass.STANDARD_INFREQUENT_ACCESS,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}

const app = new App();
new AuditLogStack(app, "AuditLogStack", {env: {region: "eu-west-1"}});
