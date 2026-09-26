# dynamodb-table-iac: Terraform for DynamoDB table "ledger"
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
#   to = aws_dynamodb_table.ledger
#   id = "ledger"
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

resource "aws_dynamodb_table" "ledger" {
  name                        = "ledger"
  billing_mode                = "PROVISIONED"
  hash_key                    = "pk"
  range_key                   = "sk"
  read_capacity               = 20
  write_capacity              = 10
  stream_enabled              = true
  stream_view_type            = "NEW_AND_OLD_IMAGES"
  table_class                 = "STANDARD_INFREQUENT_ACCESS"
  deletion_protection_enabled = true

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "account"
    type = "S"
  }

  global_secondary_index {
    name            = "by-account"
    projection_type = "ALL"
    read_capacity   = 8
    write_capacity  = 4

    key_schema {
      attribute_name = "account"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "sk"
      key_type       = "RANGE"
    }
  }

  # Replica blocks default point_in_time_recovery, deletion_protection_enabled and
  # propagate_tags to false: applying this file turns them off on the replicas
  # below unless you set them here.
  # NOT EMITTED: replica eu-west-1 overrides — table class STANDARD, read capacity 7, index "by-account" read capacity 3 (the replica block has no such arguments).
  replica {
    region_name      = "eu-west-1"
    consistency_mode = "EVENTUAL"
  }

  # Replicas of a provisioned global table are normally auto-scaled; keep Terraform
  # from fighting the scaling policy over the capacity snapshot above.
  lifecycle {
    ignore_changes = [read_capacity, write_capacity]
  }
}
