# dynamodb-table-iac: Terraform for DynamoDB table "sessions"
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
# Notes:
#   - Replica in ap-northeast-1 is "UPDATING" (kept: leaving a live replica out would make an apply delete it).
#   - Replica in sa-east-1 is DELETING and was left out.
#   - Replica in eu-central-1 belongs to account "999999999999" and was left out — manage it from that account.
#
# To adopt the live table instead of creating a new one, uncomment this import
# block, then run `terraform plan` and check that it reports no changes:
# import {
#   to = aws_dynamodb_table.sessions
#   id = "sessions"
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

resource "aws_dynamodb_table" "sessions" {
  name             = "sessions"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "pk"
  range_key        = "sk"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    name            = "by-user"
    projection_type = "ALL"

    key_schema {
      attribute_name = "userId"
      key_type       = "HASH"
    }
  }

  # Replica blocks default point_in_time_recovery, deletion_protection_enabled and
  # propagate_tags to false: applying this file turns them off on the replicas
  # below unless you set them here.
  # NOT EMITTED: replica eu-west-1 overrides — table class STANDARD_INFREQUENT_ACCESS, on-demand max read 500, index "by-user" on-demand max read 100 (the replica block has no such arguments).
  replica {
    region_name = "eu-west-1"
  }

  replica {
    region_name = "ap-northeast-1"
  }
}
