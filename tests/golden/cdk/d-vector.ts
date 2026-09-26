// dynamodb-table-iac: AWS CDK (TypeScript, aws-cdk-lib 2.271) for DynamoDB table "articles"
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
//   - Vector index "by-title-embedding" is still being created (its definition is incomplete) and was left out.
//   - TTL: not provided — include the output of `aws dynamodb describe-time-to-live` to add it.
//
// To adopt the live table instead of creating a new one, run `cdk import` on
// this stack and give it the table name when prompted; the table is retained
// when the stack is deleted (RemovalPolicy.RETAIN).

import {App, RemovalPolicy, Stack} from "aws-cdk-lib";
import type {StackProps} from "aws-cdk-lib";
import {AttributeType, Billing, TableV2} from "aws-cdk-lib/aws-dynamodb";
import type {CfnGlobalTable} from "aws-cdk-lib/aws-dynamodb";
import type {Construct} from "constructs";

export class ArticlesStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const table = new TableV2(this, "Articles", {
      tableName: "articles",
      partitionKey: {name: "pk", type: AttributeType.STRING},
      sortKey: {name: "sk", type: AttributeType.STRING},
      billing: Billing.onDemand(),
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // aws-cdk-lib 2.271 has no vector index support: the L1 is given the
    // CloudFormation properties directly.
    const cfnTable = table.node.defaultChild as CfnGlobalTable;
    cfnTable.addPropertyOverride("AttributeDefinitions", [
      {AttributeName: "pk", AttributeType: "S"},
      {AttributeName: "sk", AttributeType: "S"},
      {AttributeName: "tenant", AttributeType: "S"},
      {AttributeName: "category", AttributeType: "S"},
    ]);
    cfnTable.addPropertyOverride("VectorIndexes", [
      {
        IndexName: "by-embedding",
        VectorAttribute: {AttributeName: "embedding"},
        Dimensions: 1024,
        DistanceFunction: "COSINE",
        Projection: {ProjectionType: "ALL"},
        SearchSchema: [
          {AttributeName: "tenant", SearchSchemaElementType: "HASH"},
          {AttributeName: "category", SearchSchemaElementType: "INLINE_FILTER"},
        ],
      },
    ]);
  }
}

const app = new App();
new ArticlesStack(app, "ArticlesStack", {env: {region: "us-east-1"}});
