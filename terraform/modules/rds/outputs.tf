output "endpoint" {
  description = "RDS primary instance endpoint"
  value       = aws_db_instance.primary.endpoint
}

output "address" {
  description = "RDS primary instance address"
  value       = aws_db_instance.primary.address
}

output "port" {
  description = "RDS instance port"
  value       = aws_db_instance.primary.port
}

output "replica_endpoints" {
  description = "RDS read replica endpoints"
  value       = aws_db_instance.replica[*].endpoint
}

output "security_group_id" {
  description = "Security group ID for the RDS instance"
  value       = aws_security_group.rds.id
}
