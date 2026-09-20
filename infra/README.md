# Infra

AWS account `667747482288`, region `ap-south-1` (Mumbai), local profile `cloud-gaming`.
Design: [docs/specs/2026-09-19-aws-infra-design.md](../docs/specs/2026-09-19-aws-infra-design.md).

## Terraform (`infra/terraform`)

Creates the VPC, public subnet, security groups, IAM roles/profiles, the backend
EC2 host (+ Elastic IP) and the deploy bucket. Per-user gaming VMs, game volumes
and Elastic IPs are created at runtime by the backend, not Terraform.

```sh
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # set gaming_ami_id
terraform init
terraform plan
terraform apply
terraform output -raw backend_env              # AWS values for the backend env
```

State is local (`terraform.tfstate`, gitignored). Don't lose it.

The gaming AMI is intentionally not managed by Terraform so `terraform destroy`
can't delete it.

## Deploy the backend (`infra/scripts/deploy-backend.sh`)

Ships `git archive HEAD` to the backend host via S3 + SSM (no SSH), then runs
`npm ci`, Prisma migrations, build, and restarts `cloud-gaming.service`.

Secrets are SecureString parameters in SSM Parameter Store, never in env files:

```sh
aws ssm put-parameter --type SecureString --overwrite --name /cloud-gaming/auth-token-secret --value "$(openssl rand -base64 48 | tr -d '\n/+=')"
aws ssm put-parameter --type SecureString --overwrite --name /cloud-gaming/apollo-api-password --value '<AMI default Apollo password>'
```

The host fetches them with its instance role on every deploy and writes
`/etc/cloud-gaming.env` (root-only) = non-secret config + secrets.

```sh
cp .env.production.example .env.production     # non-secret config + terraform outputs
infra/scripts/deploy-backend.sh --env .env.production   # first deploy / env change
infra/scripts/deploy-backend.sh                          # code-only deploys
```

Shell on the backend host: `aws ssm start-session --target <backend_instance_id>`
(needs `brew install --cask session-manager-plugin`).

## Gaming AMI

`infra/ami/agent-config.yml` is the EC2Launch v2 config baked into the AMI at
`C:\ProgramData\Amazon\EC2Launch\config\agent-config.yml`. It makes the user's game
volume (`/dev/sdf`) come up as `D:` on every boot: formatted on first use, only ever
skipped-and-remounted afterwards, and it keeps `D:\SteamLibrary` in place. Validate
changes on the builder with `EC2Launch.exe validate` before baking.

Not managed by Terraform. To update it: launch a VM from the current AMI in the
EC2 console, RDP in, make changes, then **Actions → Image and templates →
Create image**, and terminate the VM. Then set `gaming_ami_id` in
`terraform.tfvars` and run `terraform apply`: this updates the launch
template, so the backend needs no change or redeploy.

Each user keeps the same VM forever (stopped, never terminated), so a new AMI
only applies to users who don't have a VM yet.

## RDP to a VM

The `cloud-gaming-vm` security group has no RDP rule. Add one temporarily in
the console (TCP 3389 from your IP) and remove it when done. Terraform manages
each rule separately, so a manually added rule isn't touched by `terraform apply`.
