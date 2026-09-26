// dynamodb-table-iac: AWS CDK (TypeScript, aws-cdk-lib 2.271) for DynamoDB table "yes"
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

export class YesStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new TableV2(this, "Yes", {
      tableName: "yes",
      partitionKey: {name: "pk\"quote", type: AttributeType.STRING},
      sortKey: {name: "sk${interp}", type: AttributeType.STRING},
      billing: Billing.onDemand(),
      globalSecondaryIndexes: [
        {
          indexName: "hostile-gsi",
          partitionKey: {name: "%{directive}", type: AttributeType.STRING},
          sortKey: {name: "back\\slash", type: AttributeType.STRING},
          projectionType: ProjectionType.INCLUDE,
          nonKeyAttributes: ["close*/comment", "line\u2028sep", "nelchar", "c1char", "__proto__", "constructor", "\nresource \"terraform_data\" \"x\" {}", "\"}); new CfnOutput(this,\"x\",{value:\"y\"}); ({\""],
        },
      ],
      localSecondaryIndexes: [
        {
          indexName: "hostile-lsi",
          sortKey: {name: "new\nline", type: AttributeType.NUMBER},
          projectionType: ProjectionType.ALL,
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}

const app = new App();
new YesStack(app, "YesStack", {env: {region: "us-east-1"}});
