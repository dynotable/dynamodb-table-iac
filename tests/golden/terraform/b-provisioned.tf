# dynamodb-table-iac: Terraform for DynamoDB table "iacfx-b-provisioned"
# Source: aws dynamodb describe-table + describe-time-to-live, region us-east-1
#
# Not emitted (configure these yourself if the live table uses them):
#   - point-in-time recovery (DescribeTable does not return it; a replica declared without it has PITR off)
#   - tags (DescribeTable does not return them; applying removes live tags)
#   - auto-scaling policies (a fixed capacity snapshot is emitted instead; applying replaces the policy with that snapshot)
#   - warm throughput (DescribeTable reports the CURRENT value, which grows with traffic; emitting it would bill a pre-warm)
#   - contributor insights, Kinesis streaming destinations and resource policies (DescribeTable does not return them)
#   - the KMS key ARN of an SSE-encrypted table (DescribeTable cannot tell an AWS-managed key from a customer-managed one; the AWS-managed key is emitted and the live ARN is left in a comment)
#   - settings of non-home replicas that DynamoDB never synchronizes (their deletion protection, PITR and tags are only visible from their own region)
#
# To adopt the live table instead of creating a new one, uncomment this import
# block, then run `terraform plan` and check that it reports no changes:
# import {
#   to = aws_dynamodb_table.iacfx_b_provisioned
#   id = "iacfx-b-provisioned"
# }

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.29"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

resource "aws_dynamodb_table" "iacfx_b_provisioned" {
  name           = "iacfx-b-provisioned"
  billing_mode   = "PROVISIONED"
  hash_key       = "pk"
  range_key      = "sk"
  read_capacity  = 5
  write_capacity = 10

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "email"
    type = "S"
  }

  attribute {
    name = "score"
    type = "N"
  }

  global_secondary_index {
    name            = "by-email"
    projection_type = "KEYS_ONLY"
    read_capacity   = 2
    write_capacity  = 3

    key_schema {
      attribute_name = "email"
      key_type       = "HASH"
    }
  }

  local_secondary_index {
    name            = "by-score"
    range_key       = "score"
    projection_type = "ALL"
  }
}
