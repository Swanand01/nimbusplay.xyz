variable "aws_profile" {
  description = "Local AWS CLI profile used by Terraform."
  type        = string
  default     = "cloud-gaming"
}

variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "availability_zone" {
  description = "Single AZ for the backend, gaming VMs and game volumes (EBS volumes are AZ-bound)."
  type        = string
  default     = "ap-south-1b"
}

variable "gaming_ami_id" {
  description = "Windows gaming AMI with Apollo. Managed outside Terraform so destroy never deletes it."
  type        = string
}

variable "gaming_instance_type" {
  type    = string
  default = "g4dn.xlarge"
}

variable "backend_instance_type" {
  type    = string
  default = "t4g.small"
}

variable "api_allowed_cidr" {
  description = "Who can reach the backend API on TCP 8080."
  type        = string
  default     = "0.0.0.0/0"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "public_subnet_cidr" {
  type    = string
  default = "10.20.1.0/24"
}
