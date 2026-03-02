variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "secondary_region" {
  description = "Secondary AWS region for disaster recovery"
  type        = string
  default     = "eu-west-1"
}

variable "source_bucket_arn" {
  description = "ARN of the primary S3 bucket to replicate"
  type        = string
}

variable "rds_instance_arn" {
  description = "ARN of the primary RDS instance for backup replication"
  type        = string
  default     = ""
}

variable "enable_rds_backup_replication" {
  description = "Whether to enable cross-region RDS backup replication"
  type        = bool
  default     = true
}
