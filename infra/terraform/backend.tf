data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_caller_identity" "current" {}

# Deploy tarballs and the backend env file are staged here by infra/scripts/deploy-backend.sh.
resource "aws_s3_bucket" "deploy" {
  bucket        = "cloud-gaming-deploy-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "deploy" {
  bucket                  = aws_s3_bucket.deploy.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "deploy" {
  bucket = aws_s3_bucket.deploy.id

  rule {
    id     = "expire-old-artifacts"
    status = "Enabled"
    filter {}
    expiration {
      days = 30
    }
  }
}

resource "aws_instance" "backend" {
  ami                    = data.aws_ssm_parameter.al2023_arm64.value
  instance_type          = var.backend_instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.backend.id]
  iam_instance_profile   = aws_iam_instance_profile.backend.name
  user_data              = file("${path.module}/backend-user-data.sh")

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
  }

  metadata_options {
    http_tokens = "required"
  }

  tags = { Name = "cloud-gaming-backend" }

  lifecycle {
    # Don't replace the backend (and its SQLite DB) whenever AWS publishes a newer AL2023 AMI.
    ignore_changes = [ami, user_data]
  }
}

resource "aws_eip" "backend" {
  domain   = "vpc"
  instance = aws_instance.backend.id

  tags = { Name = "cloud-gaming-backend" }
}
