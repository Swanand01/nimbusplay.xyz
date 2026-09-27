# Cloud Gaming AWS Infra (Prototype)

Date: 2026-09-19
Account: 667747482288 (profile `cloud-gaming`), region ap-south-1 (Mumbai)

## Goal

Put the backend and the per-user gaming VMs in one VPC so the backend reaches
Apollo's Web UI/API (TCP 47990) over private IPs, and 47990 is never exposed to
the internet. Manage the static infra with Terraform. Prototype scope: no
enterprise hardening.

## Out of Terraform

- **Gaming AMI**: `ami-0b5913a08c8b2ff4f` (baked 2026-09-20: Apollo a7eb5e9, clean of personal logins/paired devices, EC2Launch initializeVolume for the D: game volume). Passed
  in as a variable so `terraform destroy` can never delete it. Updated by
  baking a new AMI from a builder VM (see "AMI updates").
- **Per-user VMs and game volumes**: created at runtime by the backend. VMs use the
  subnet's auto-assigned public IP, which AWS bills only while the VM runs; a reserved
  Elastic IP costs ~$3.65/user/month around the clock. The address changes each
  session, and the pairing link carries the current one.

## Terraform layout

`cloud-gaming/infra/terraform/`, single root module, local state (gitignored).

| File | Contents |
|---|---|
| `versions.tf` | Terraform + AWS provider pins, provider config (profile/region vars) |
| `variables.tf` | `aws_profile`, `region`, `availability_zone` (ap-south-1b), `gaming_ami_id`, `backend_instance_type` (t4g.small), `api_allowed_cidr` (0.0.0.0/0) |
| `network.tf` | VPC, IGW, one public subnet, route table |
| `security.tf` | `gaming-vm` and `backend` security groups |
| `iam.tf` | Gaming VM role/profile, backend role/profile |
| `backend.tf` | Backend EC2 + Elastic IP, deploy S3 bucket |
| `gaming.tf` | Gaming VM launch template |
| `outputs.tf` | Values the backend `.env` needs |

## Network

- VPC `10.20.0.0/16`, DNS hostnames on, internet gateway.
- One public subnet `10.20.1.0/24` in ap-south-1b (game volumes are AZ-bound,
  so everything lives in one AZ). Default route to the IGW.
- No NAT gateway, no private subnet.

## Security groups

`gaming-vm`:
- Ingress from `0.0.0.0/0`: TCP 47984, 47989, 48010; UDP 47998-48000.
- Ingress TCP 47990 from the `backend` SG only.
- No RDP/SSH ingress (add a temporary RDP rule in the console when needed).
- Egress: all.

`backend`:
- Ingress TCP 8080 from `api_allowed_cidr` (default everyone).
- No SSH ingress (SSM).
- Egress: all.

## IAM

Gaming VM role (`cloud-gaming-vm`, trusted by ec2.amazonaws.com):
- `s3:GetObject`/`s3:ListBucket` on the NVIDIA driver buckets
  (`ec2-windows-nvidia-drivers`, `nvidia-gaming`).
- `AmazonSSMManagedInstanceCore`.

Backend role (`cloud-gaming-backend`):
- EC2: Run/Start/Stop/Describe instances, Create/Attach/Describe volumes, CreateTags,
  and waiter describe calls.
- `iam:PassRole` on the gaming VM role only.
- `s3:GetObject` on the deploy bucket.
- `AmazonSSMManagedInstanceCore`.
- The backend uses instance-role credentials; no access keys on the box.

## Backend host

- `t4g.small`, Amazon Linux 2023 arm64 (latest via SSM public parameter),
  20 GB gp3 root, Elastic IP, in the public subnet with the `backend` SG.
- User data: install Node 22 + tar, create `cloudgaming` user, app dir
  `/opt/cloud-gaming`, data dir `/opt/cloud-gaming/data` (SQLite), systemd unit
  `cloud-gaming.service` running `node dist/server.js` with
  `EnvironmentFile=/etc/cloud-gaming.env`, `HOST=0.0.0.0`.
- Secrets (`AUTH_TOKEN_SECRET`, `APOLLO_API_PASSWORD`) are SSM Parameter Store
  SecureStrings under `/cloud-gaming/`, created by hand (not Terraform, so they
  never land in state). On each deploy the host fetches them with its instance
  role and writes root-only `/etc/cloud-gaming.env` = non-secret config + secrets.

## Deploy flow (`infra/scripts/deploy-backend.sh`)

1. Tar the backend source (excluding `node_modules`, `data`, `dist`, `.env`).
2. Upload to the deploy S3 bucket.
3. `aws ssm send-command` on the backend instance: download, extract,
   `npm ci`, `npx prisma generate`, `npx prisma migrate deploy`, `npm run build`,
   restart the service.
4. Env file is uploaded separately (`deploy-backend.sh --env <file>`).

## Backend config changes

- VMs launch from a Terraform-managed launch template (`gaming.tf`: AMI,
  instance type, subnet, security group, instance profile, tags). The backend
  needs only `AWS_LAUNCH_TEMPLATE_ID` and `AWS_AVAILABILITY_ZONE` (for volumes).
- `APOLLO_API_USE_PRIVATE_IP=true`.
- No key pair on VMs.
- Per-user lock on `/sessions/start` so concurrent requests can't launch two VMs.

## VM lifecycle rule

One VM per user, always the same VM. VMs are stopped, never terminated or
replaced. A new AMI therefore only applies to users who don't have a VM yet;
existing VMs are updated in place (SSM/RDP) if needed.

## AMI updates

Manual via the EC2 console: launch from the current AMI, RDP in, change,
Create image, terminate. Then update `gaming_ami_id` and `terraform apply` (updates the launch template; no backend change). Only users
without a VM get the new image (see VM lifecycle rule).

## Admin access

No RDP/SSH rules by default. Add a temporary TCP 3389 rule for your IP in the
console when needed and remove it afterwards.

## Follow-ups (not in this change)

- Set Apollo `origin_web_ui_allowed = lan` in the next AMI bake.
- Old account cleanup (VM, volume, EIP, AMI, root access keys).
