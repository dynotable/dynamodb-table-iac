# dynamodb-table-iac

Export a DynamoDB table definition as runnable infrastructure code. Feed it the
JSON that `aws dynamodb describe-table` prints (plus, optionally,
`describe-time-to-live`) and get back Terraform (`aws_dynamodb_table`), AWS CDK
(`TableV2`) or CloudFormation (`AWS::DynamoDB::GlobalTable`) — global-table
replicas included. Zero dependencies.

## Install

```sh
npm install dynamodb-table-iac
```

ESM and CJS, browser-safe, no dependencies.

## Usage

```ts
import {emitTerraform, emitCdk, emitCloudFormation, parseDescribeTableJson} from 'dynamodb-table-iac';

const parsed = parseDescribeTableJson(describeTableOutput); // the CLI's `{"Table": …}` or a bare Table
if (!parsed.ok) throw new Error(parsed.reason);

const input = {table: parsed.table, timeToLive: ttlDescription, region: 'eu-west-1'};

emitTerraform(input);                            // {ok: true, code: 'terraform { … }'}
emitCdk(input);                                  // a complete CDK app on TableV2
emitCloudFormation(input, {syntax: 'yaml'});     // or {syntax: 'json'}
```

Every emitter returns `{ok: true, code}` or `{ok: false, reason}` — a reason is
one English sentence naming what could not be represented and how to fix it.

## What is emitted

Key schema and the attribute definitions the emitted keys reference, billing
mode and throughput (table and per-index), global and local secondary indexes,
TTL, deletion protection, streams, SSE (KMS, without a key ARN — see below),
table class, on-demand maximum throughput, vector indexes where the target
supports them, and global-table replicas (regions, consistency mode, witness,
per-replica overrides where the target can express them).

## What is not emitted

Stated in the header of every generated file, with the consequence of applying
it over the live table:

- point-in-time recovery, tags, auto-scaling policies (a capacity snapshot is
  emitted instead), warm throughput, contributor insights, Kinesis streaming
  destinations and resource policies — `DescribeTable` does not return them;
- the KMS key ARN of an SSE-encrypted table — `DescribeTable` cannot tell an
  AWS-managed key from a customer-managed one, so the config uses the
  AWS-managed key and the live ARN is left in a comment;
- settings of non-home replicas that are never synchronized (their deletion
  protection, PITR, tags) and replicas that belong to another account;
- replicas in the `DELETING` state.

## Per-target notes

- **Terraform** — the AWS provider has no DynamoDB vector-index support, so a
  vector index becomes a `# NOT EMITTED` comment carrying its definition.
- **AWS CDK** — `TableV2` requires auto-scaled write capacity on a provisioned
  table (min = max = the current WCU is emitted), applies the table's deletion
  protection to every replica, and puts a stream on strong-consistency tables;
  a strong-consistency region set outside one of CDK's region groups is
  refused rather than emitted as code that will not synthesize.
- **CloudFormation** — always `AWS::DynamoDB::GlobalTable` (a single-region
  table is one replica), matching the CDK output resource for resource.

## Verification

`aws cloudformation validate-template` is a manual check over the CloudFormation
goldens; CI runs `terraform plan`, `cdk synth` and `cfn-lint` over every golden.
