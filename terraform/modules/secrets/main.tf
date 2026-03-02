# ─── CashTrace — Secrets Module ───────────────────────────────────────────────
#
# AWS Secrets Manager with rotation, encryption, and environment isolation.
# Requirements: 6.1–6.6

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ─── KMS Key for Secrets Encryption ──────────────────────────────────────────

resource "aws_kms_key" "secrets" {
  description             = "KMS key for ${var.project_name}-${var.environment} secrets"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowRootAccount"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      }
    ]
  })

  tags = {
    Name        = "${var.project_name}-${var.environment}-secrets-key"
    Environment = var.environment
  }
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${var.project_name}-${var.environment}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

# ─── Secrets ──────────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "app" {
  for_each = var.secrets

  name        = "${var.project_name}/${var.environment}/${each.key}"
  description = "Secret for ${each.key} in ${var.environment}"
  kms_key_id  = aws_kms_key.secrets.arn

  tags = {
    Name        = each.key
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "app" {
  for_each = var.secrets

  secret_id     = aws_secretsmanager_secret.app[each.key].id
  secret_string = each.value
}

# ─── Rotation Configuration ──────────────────────────────────────────────────

resource "aws_secretsmanager_secret_rotation" "app" {
  for_each = var.rotation_enabled ? var.secrets : {}

  secret_id           = aws_secretsmanager_secret.app[each.key].id
  rotation_lambda_arn = var.rotation_lambda_arn

  rotation_rules {
    automatically_after_days = var.rotation_days
  }
}

# ─── IAM Policy for Secret Access ────────────────────────────────────────────

resource "aws_iam_policy" "secret_read" {
  name        = "${var.project_name}-${var.environment}-secret-read"
  description = "Allow reading secrets for ${var.environment}"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [for s in aws_secretsmanager_secret.app : s.arn]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey"
        ]
        Resource = [aws_kms_key.secrets.arn]
      }
    ]
  })
}
