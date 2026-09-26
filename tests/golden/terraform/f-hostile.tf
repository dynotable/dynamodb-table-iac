# dynamodb-table-iac: Terraform for DynamoDB table "yes"
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
#   to = aws_dynamodb_table.yes
#   id = "yes"
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

resource "aws_dynamodb_table" "yes" {
  name         = "yes"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk\"quote"
  range_key    = "sk$${interp}"

  attribute {
    name = "pk\"quote"
    type = "S"
  }

  attribute {
    name = "sk$${interp}"
    type = "S"
  }

  attribute {
    name = "%%{directive}"
    type = "S"
  }

  attribute {
    name = "back\\slash"
    type = "S"
  }

  attribute {
    name = "new\nline"
    type = "N"
  }

  global_secondary_index {
    name               = "hostile-gsi"
    projection_type    = "INCLUDE"
    non_key_attributes = ["close*/comment", "line\u2028sep", "nel\u0085char", "c1\u009fchar", "__proto__", "constructor", "\nresource \"terraform_data\" \"x\" {}", "\"}); new CfnOutput(this,\"x\",{value:\"y\"}); ({\""]

    key_schema {
      attribute_name = "%%{directive}"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "back\\slash"
      key_type       = "RANGE"
    }
  }

  local_secondary_index {
    name            = "hostile-lsi"
    range_key       = "new\nline"
    projection_type = "ALL"
  }
}
