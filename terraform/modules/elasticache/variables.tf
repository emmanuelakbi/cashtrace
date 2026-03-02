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
  description = "Security group IDs allowed to connect to Redis"
  type        = list(string)
}

variable "node_type" {
  type    = string
  default = "cache.t3.medium"
}

variable "num_cache_nodes" {
  type    = number
  default = 2
}

variable "automatic_failover" {
  type    = bool
  default = true
}

variable "engine_version" {
  type    = string
  default = "7.0"
}
