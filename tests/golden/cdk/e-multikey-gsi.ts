// dynamodb-table-iac: AWS CDK (TypeScript, aws-cdk-lib 2.271) for DynamoDB table "events"
// Source: aws dynamodb describe-table, region us-east-1
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
//   - TTL: not provided — include the output of `aws dynamodb describe-time-to-live` to add it.
//
// To adopt the live table instead of creating a new one, run `cdk import` on
// this stack and give it the table name when prompted; the table is retained
// when the stack is deleted (RemovalPolicy.RETAIN).

import {App, RemovalPolicy, Stack} from "aws-cdk-lib";
import type {StackProps} from "aws-cdk-lib";
import {AttributeType, Billing, ProjectionType, TableV2} from "aws-cdk-lib/aws-dynamodb";
import type {Construct} from "constructs";

export class EventsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new TableV2(this, "Events", {
      tableName: "events",
      partitionKey: {name: "pk", type: AttributeType.STRING},
      sortKey: {name: "sk", type: AttributeType.STRING},
      billing: Billing.onDemand(),
      globalSecondaryIndexes: [
        {
          indexName: "by-tenant-kind",
          partitionKeys: [{name: "tenant", type: AttributeType.STRING}, {name: "kind", type: AttributeType.STRING}],
          sortKeys: [{name: "ts", type: AttributeType.NUMBER}, {name: "actor", type: AttributeType.STRING}],
          projectionType: ProjectionType.KEYS_ONLY,
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}

const app = new App();
new EventsStack(app, "EventsStack", {env: {region: "us-east-1"}});
