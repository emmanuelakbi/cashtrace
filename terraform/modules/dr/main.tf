# ─── CashTrace — Disaster Recovery Module ─────────────────────────────────────
#
# Cross-region replication for S3, RDS snapshots, and secrets backup.
# Requirements: 11.1–11.6
#
# Primary: af-south-1 (Cape Town)
# Secondary: eu-west-1 (Ireland) — closest supported region for failover

# ─── Secondary Region Provider ───────────────────────────────────────────────

provider "aws" {
  alias  = "secondary"
  region = var.secondary_region
}

# ─── S3 Cross-Region Replication ─────────────────────────────────────────────

resource "aws_s3_bucket" "dr_backup" {
  provider = aws.secondary
  bucket   = "${var.project_name}-${var.environment}-dr-backup"

  tags = {
    Name        = "${var.project_name}-${var.environment}-dr-backup"
    Environment = var.environment
    Purpose     = "disaster-recovery"
  }
}

resource "aws_s3_bucket_versioning" "dr_backup" {
  provider = aws.secondary
  bucket   = aws_s3_bucket.dr_backup.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "dr_backup" {
  provider = aws.secondary
  bucket   = aws_s3_bucket.dr_backup.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "dr_backup" {
  provider = aws.secondary
  bucket   = aws_s3_bucket.dr_backup.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ─── IAM Role for Replication ────────────────────────────────────────────────

resource "aws_iam_role" "replication" {
  name = "${var.project_name}-${var.environment}-s3-replication"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "replication" {
  name = "${var.project_name}-${var.environment}-s3-replication"
  role = aws_iam_role.replication.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket"
        ]
        Resource = [var.source_bucket_arn]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging"
        ]
        Resource = ["${var.source_bucket_arn}/*"]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags"
        ]
        Resource = ["${aws_s3_bucket.dr_backup.arn}/*"]
      }
    ]
  })
}

# ─── RDS Automated Backup Replication ────────────────────────────────────────

resource "aws_db_instance_automated_backups_replication" "main" {
  count                  = var.enable_rds_backup_replication ? 1 : 0
  provider               = aws.secondary
  source_db_instance_arn = var.rds_instance_arn
  retention_period       = 30
}
