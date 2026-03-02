# ─── CashTrace — Production Backend Configuration ────────────────────────────
#
# Usage: terraform init -backend-config=backend.hcl
#
# S3 backend with encryption and DynamoDB locking for state management.
# All state stored in af-south-1 for data residency compliance.

bucket         = "cashtrace-terraform-state"
key            = "production/terraform.tfstate"
region         = "af-south-1"
dynamodb_table = "cashtrace-terraform-locks"
encrypt        = true
