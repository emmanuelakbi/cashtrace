# ─── CashTrace — Root Terraform Configuration ────────────────────────────────
#
# Primary region: af-south-1 (Cape Town) for Nigerian data residency compliance.
# Remote state stored in S3 with DynamoDB locking.
#
# Requirements:
#   4.2 — Support multiple cloud providers (AWS primary, with abstraction)
#   4.6 — Maintain state in secure remote backend
#  13.1 — Store all user data in African region (Cape Town)

terraform {
  required_version = ">= 1.5.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }

  # Backend is configured per-environment via -backend-config files.
  # See terraform/environments/{env}/backend.hcl
  backend "s3" {
    bucket         = "cashtrace-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "af-south-1"
    dynamodb_table = "cashtrace-terraform-locks"
    encrypt        = true
  }
}

# ─── Primary Provider (af-south-1 — Cape Town) ───────────────────────────────

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project        = var.project_name
      ManagedBy      = "Terraform"
      Environment    = var.environment
      DataResidency  = "af-south-1"
      CostCenter     = "${var.project_name}-${var.environment}"
    }
  }
}

# ─── Data Sources ─────────────────────────────────────────────────────────────

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ─── Data Residency Enforcement ───────────────────────────────────────────────

locals {
  # Allowed regions for data storage — Nigerian data residency compliance
  allowed_regions = var.allowed_data_regions

  # Verify the active region is in the allowed list
  region_compliant = contains(local.allowed_regions, data.aws_region.current.name)
}

resource "null_resource" "data_residency_check" {
  count = local.region_compliant ? 0 : 1

  provisioner "local-exec" {
    command = "echo 'ERROR: Region ${data.aws_region.current.name} is not in allowed data residency regions: ${join(", ", local.allowed_regions)}' && exit 1"
  }
}
