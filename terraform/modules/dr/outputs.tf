output "dr_bucket_arn" {
  description = "ARN of the DR backup S3 bucket"
  value       = aws_s3_bucket.dr_backup.arn
}

output "dr_bucket_name" {
  description = "Name of the DR backup S3 bucket"
  value       = aws_s3_bucket.dr_backup.id
}

output "replication_role_arn" {
  description = "ARN of the S3 replication IAM role"
  value       = aws_iam_role.replication.arn
}
