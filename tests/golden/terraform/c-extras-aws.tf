# dynamodb-table-iac: Terraform for DynamoDB table "audit-log"
# Source: aws dynamodb describe-table, region eu-west-1
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
#   - SSE uses KMS key "arn:aws:kms:eu-west-1:123456789012:key/1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b" — if that is a customer-managed key, set it on the emitted encryption setting.
#   - TTL: not provided — include the output of `aws dynamodb describe-time-to-live` to add it.
#
# To adopt the live table instead of creating a new one, uncomment this import
# block, then run `terraform plan` and check that it reports no changes:
# import {
#   to = aws_dynamodb_table.audit_log
#   id = "audit-log"
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
  region = "eu-west-1"
}

resource "aws_dynamodb_table" "audit_log" {
  name         = "audit-log"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  table_class  = "STANDARD_INFREQUENT_ACCESS"

  attribute {
    name = "pk"
    type = "S"
  }

  on_demand_throughput {
    max_read_request_units = 2000
  }

  server_side_encryption {
    enabled = true
    # Uncomment if the live key is customer-managed (DescribeTable cannot tell):
    # kms_key_arn = "arn:aws:kms:eu-west-1:123456789012:key/1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b"
  }
}
