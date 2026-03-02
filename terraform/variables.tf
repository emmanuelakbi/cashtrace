# ─── CashTrace — Root Variables ───────────────────────────────────────────────
#
# Requirements:
#   4.2 — Support multiple cloud providers (AWS primary)
#  13.1 — Store all user data in African region

variable "aws_region" {
  description = "Primary AWS region (Cape Town for Nigerian data residency)"
  type        = string
  default     = "af-south-1"

  validation {
    condition     = var.aws_region == "af-south-1"
    error_message = "AWS region must be af-south-1 (Cape Town) for Nigerian data residency compliance."
  }
}

variable "environment" {
  description = "Deployment environment (development, staging, production)"
  type        = string

  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "Environment must be one of: development, staging, production."
  }
}

variable "project_name" {
  description = "Project name used for resource naming and tagging"
  type        = string
  default     = "cashtrace"
}

variable "allowed_data_regions" {
  description = "Regions where user data may be stored (data residency compliance)"
  type        = list(string)
  default     = ["af-south-1"]

  validation {
    condition     = length(var.allowed_data_regions) > 0
    error_message = "At least one allowed data region must be specified."
  }

  validation {
    condition     = alltrue([for r in var.allowed_data_regions : can(regex("^af-", r))])
    error_message = "All allowed data regions must be in Africa (af-*) for Nigerian data residency compliance."
  }
}

variable "enable_data_residency_guard" {
  description = "Enable runtime data residency enforcement checks"
  type        = bool
  default     = true
}

variable "state_bucket_name" {
  description = "S3 bucket name for Terraform remote state"
  type        = string
  default     = "cashtrace-terraform-state"
}

variable "state_lock_table" {
  description = "DynamoDB table name for Terraform state locking"
  type        = string
  default     = "cashtrace-terraform-locks"
}
