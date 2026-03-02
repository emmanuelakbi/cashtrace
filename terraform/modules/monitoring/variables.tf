variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "ecs_cluster_name" {
  description = "ECS cluster name for monitoring"
  type        = string
}

variable "ecs_service_name" {
  description = "ECS service name for monitoring"
  type        = string
}

variable "alb_arn_suffix" {
  description = "ALB ARN suffix for CloudWatch metrics"
  type        = string
}

variable "rds_instance_id" {
  description = "RDS instance identifier for monitoring"
  type        = string
}

variable "pagerduty_endpoint" {
  description = "PagerDuty HTTPS endpoint for alert integration"
  type        = string
  default     = ""
}
