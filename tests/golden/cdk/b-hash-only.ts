// dynamodb-table-iac: AWS CDK (TypeScript, aws-cdk-lib 2.271) for DynamoDB table "iacfx-b-hash-only"
// Source: aws dynamodb describe-table + describe-time-to-live, region us-east-1
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
//   - Provisioned write capacity is emitted as Capacity.autoscaled with min = max = the current WCU (TableV2 refuses a fixed write capacity); the live scaling policy is not part of DescribeTable.
//
// To adopt the live table instead of creating a new one, run `cdk import` on
// this stack and give it the table name when prompted; the table is retained
// when the stack is deleted (RemovalPolicy.RETAIN).

import {App, RemovalPolicy, Stack} from "aws-cdk-lib";
import type {StackProps} from "aws-cdk-lib";
import {AttributeType, Billing, Capacity, TableV2} from "aws-cdk-lib/aws-dynamodb";
import type {Construct} from "constructs";

export class IacfxBHashOnlyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new TableV2(this, "IacfxBHashOnly", {
      tableName: "iacfx-b-hash-only",
      partitionKey: {name: "id", type: AttributeType.STRING},
      billing: Billing.provisioned({
        readCapacity: Capacity.fixed(1),
        writeCapacity: Capacity.autoscaled({minCapacity: 1, maxCapacity: 1}),
      }),
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}

const app = new App();
new IacfxBHashOnlyStack(app, "IacfxBHashOnlyStack", {env: {region: "us-east-1"}});
