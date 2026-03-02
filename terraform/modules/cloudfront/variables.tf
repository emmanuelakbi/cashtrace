variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "alb_dns_name" {
  description = "DNS name of the ALB origin"
  type        = string
}

variable "s3_bucket_domain" {
  description = "S3 bucket regional domain name for static assets (optional)"
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for custom domain HTTPS (optional)"
  type        = string
  default     = ""
}
