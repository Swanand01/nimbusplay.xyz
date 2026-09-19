# AWS Infra

The first MVP uses an existing AMI, key pair, and security group:

```text
AMI: ami-04fe85ad48985c7e7
Key pair: Gaming
Security group: sg-0b0cd0139dbf5796e
Region: ap-south-1
```

The backend launches and terminates EC2 instances directly through the AWS SDK.

Terraform/OpenTofu should be added here for:

```text
VPC/subnet
security groups
IAM policy for backend
backend deployment
DNS
```

For local MVP testing, no Terraform is required if the resources above already exist.

