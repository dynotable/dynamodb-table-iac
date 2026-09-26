# dynamodb-table-iac: Terraform for DynamoDB table "carts"
# Source: aws dynamodb describe-table, region us-east-1
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
# Notes:
#   - TTL: not provided — include the output of `aws dynamodb describe-time-to-live` to add it.
#
# To adopt the live table instead of creating a new one, uncomment this import
# block, then run `terraform plan` and check that it reports no changes:
# import {
#   to = aws_dynamodb_table.carts
#   id = "carts"
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

resource "aws_dynamodb_table" "carts" {
  name         = "carts"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  # Replica blocks default point_in_time_recovery, deletion_protection_enabled and
  # propagate_tags to false: applying this file turns them off on the replicas
  # below unless you set them here.
  replica {
    region_name      = "us-east-2"
    consistency_mode = "STRONG"
  }

  global_table_witness {
    region_name = "us-west-2"
  }
}
