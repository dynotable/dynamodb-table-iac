// dynamodb-table-iac: AWS CDK (TypeScript, aws-cdk-lib 2.271) for DynamoDB table "ledger"
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
//   - Provisioned write capacity is emitted as Capacity.autoscaled with min = max = the current WCU (TableV2 refuses a fixed write capacity); the live scaling policy is not part of DescribeTable.
//
// TableV2 cannot express the live table exactly:
//   - TableV2 applies the table's deletion protection to every replica (the L2 has no per-replica off switch); the live replicas' own setting is not readable from the home region.
//
// To adopt the live table instead of creating a new one, run `cdk import` on
// this stack and give it the table name when prompted; the table is retained
// when the stack is deleted (RemovalPolicy.RETAIN).

import {App, RemovalPolicy, Stack} from "aws-cdk-lib";
import type {StackProps} from "aws-cdk-lib";
import {AttributeType, Billing, Capacity, ProjectionType, StreamViewType, TableClass, TableV2} from "aws-cdk-lib/aws-dynamodb";
import type {Construct} from "constructs";

export class LedgerStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new TableV2(this, "Ledger", {
      tableName: "ledger",
      partitionKey: {name: "pk", type: AttributeType.STRING},
      sortKey: {name: "sk", type: AttributeType.STRING},
      billing: Billing.provisioned({
        readCapacity: Capacity.fixed(20),
        writeCapacity: Capacity.autoscaled({minCapacity: 10, maxCapacity: 10}),
      }),
      globalSecondaryIndexes: [
        {
          indexName: "by-account",
          partitionKey: {name: "account", type: AttributeType.STRING},
          sortKey: {name: "sk", type: AttributeType.STRING},
          projectionType: ProjectionType.ALL,
          readCapacity: Capacity.fixed(8),
          writeCapacity: Capacity.autoscaled({minCapacity: 4, maxCapacity: 4}),
        },
      ],
      dynamoStream: StreamViewType.NEW_AND_OLD_IMAGES,
      tableClass: TableClass.STANDARD_INFREQUENT_ACCESS,
      deletionProtection: true,
      replicas: [
        {
          region: "eu-west-1",
          tableClass: TableClass.STANDARD,
          readCapacity: Capacity.fixed(7),
          globalSecondaryIndexOptions: {
            "by-account": {readCapacity: Capacity.fixed(3)},
          },
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}

const app = new App();
new LedgerStack(app, "LedgerStack", {env: {region: "us-east-1"}});
