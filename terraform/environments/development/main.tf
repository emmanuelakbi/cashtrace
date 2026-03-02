# ─── CashTrace — Development Environment ─────────────────────────────────────
#
# Initialize with:
#   terraform init -backend-config=backend.hcl
#   terraform plan -var-file=terraform.tfvars
#   terraform apply -var-file=terraform.tfvars

terraform {
  required_version = ">= 1.5.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }

  backend "s3" {}
}

module "infrastructure" {
  source = "../../"

  environment                = "development"
  aws_region                 = "af-south-1"
  project_name               = "cashtrace"
  allowed_data_regions       = ["af-south-1"]
  enable_data_residency_guard = true
}

output "region" {
  value = module.infrastructure.region
}

output "environment" {
  value = module.infrastructure.environment
}

output "account_id" {
  value = module.infrastructure.account_id
}

output "data_residency_compliant" {
  value = module.infrastructure.data_residency_compliant
}
