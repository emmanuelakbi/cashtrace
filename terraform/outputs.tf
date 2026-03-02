# ─── CashTrace — Root Outputs ─────────────────────────────────────────────────
#
# Useful outputs for downstream modules and CI/CD pipelines.

output "region" {
  description = "AWS region where resources are deployed"
  value       = data.aws_region.current.name
}

output "environment" {
  description = "Current deployment environment"
  value       = var.environment
}

output "account_id" {
  description = "AWS account ID"
  value       = data.aws_caller_identity.current.account_id
}

output "caller_arn" {
  description = "ARN of the caller identity (for audit)"
  value       = data.aws_caller_identity.current.arn
}

output "project_name" {
  description = "Project name used for resource naming"
  value       = var.project_name
}

output "data_residency_compliant" {
  description = "Whether the current region is compliant with data residency requirements"
  value       = local.region_compliant
}

output "allowed_data_regions" {
  description = "Regions approved for data storage"
  value       = var.allowed_data_regions
}

output "state_bucket" {
  description = "S3 bucket used for Terraform remote state"
  value       = var.state_bucket_name
}

output "state_lock_table" {
  description = "DynamoDB table used for Terraform state locking"
  value       = var.state_lock_table
}
