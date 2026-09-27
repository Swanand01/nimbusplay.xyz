data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

# --- Gaming VMs ---

resource "aws_iam_role" "gaming_vm" {
  name               = "cloud-gaming-vm"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

data "aws_iam_policy_document" "gaming_vm" {
  statement {
    sid     = "NvidiaDrivers"
    actions = ["s3:GetObject", "s3:ListBucket"]
    resources = [
      "arn:aws:s3:::ec2-windows-nvidia-drivers",
      "arn:aws:s3:::ec2-windows-nvidia-drivers/*",
      "arn:aws:s3:::nvidia-gaming",
      "arn:aws:s3:::nvidia-gaming/*",
    ]
  }
}

resource "aws_iam_role_policy" "gaming_vm" {
  name   = "nvidia-drivers"
  role   = aws_iam_role.gaming_vm.id
  policy = data.aws_iam_policy_document.gaming_vm.json
}

resource "aws_iam_role_policy_attachment" "gaming_vm_ssm" {
  role       = aws_iam_role.gaming_vm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "gaming_vm" {
  name = "cloud-gaming-vm"
  role = aws_iam_role.gaming_vm.name
}

# --- Backend ---

resource "aws_iam_role" "backend" {
  name               = "cloud-gaming-backend"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

data "aws_iam_policy_document" "backend" {
  statement {
    sid = "ManageGamingVms"
    actions = [
      "ec2:RunInstances",
      "ec2:StartInstances",
      "ec2:StopInstances",
      "ec2:DescribeInstances",
      "ec2:CreateVolume",
      "ec2:AttachVolume",
      "ec2:DescribeVolumes",
      "ec2:CreateTags",
      "ec2:DescribeLaunchTemplates",
      "ec2:DescribeLaunchTemplateVersions",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "PassGamingVmRole"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.gaming_vm.arn]
  }

  statement {
    sid       = "ReadDeployArtifacts"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.deploy.arn}/*"]
  }

  # Secrets (SecureString, default aws/ssm key), fetched by deploy-backend.sh on the host.
  statement {
    sid       = "ReadSecrets"
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = ["arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/cloud-gaming/*"]
  }

  # deploy-backend.sh deletes the staged env file after installing it.
  statement {
    sid       = "DeleteStagedEnv"
    actions   = ["s3:DeleteObject"]
    resources = ["${aws_s3_bucket.deploy.arn}/env/*"]
  }
}

resource "aws_iam_role_policy" "backend" {
  name   = "cloud-gaming-backend"
  role   = aws_iam_role.backend.id
  policy = data.aws_iam_policy_document.backend.json
}

resource "aws_iam_role_policy_attachment" "backend_ssm" {
  role       = aws_iam_role.backend.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "backend" {
  name = "cloud-gaming-backend"
  role = aws_iam_role.backend.name
}
