variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "allowed_security_groups" {
  description = "Security group IDs allowed to connect to the database"
  type        = list(string)
}

variable "instance_class" {
  type    = string
  default = "db.t3.medium"
}

variable "engine_version" {
  type    = string
  default = "16"
}

variable "allocated_storage_gb" {
  type    = number
  default = 50
}

variable "database_name" {
  type    = string
  default = "cashtrace"
}

variable "master_username" {
  type      = string
  default   = "cashtrace_admin"
  sensitive = true
}

variable "master_password" {
  type      = string
  sensitive = true
}

variable "multi_az" {
  type    = bool
  default = true
}

variable "backup_retention_days" {
  type    = number
  default = 30
}

variable "read_replicas" {
  type    = number
  default = 1
}
