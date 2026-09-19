# Cloud Gaming AWS Infra (Prototype)

Date: 2026-09-19
Account: 667747482288 (profile `cloud-gaming`), region ap-south-1 (Mumbai)

## Goal

Put the backend and the per-user gaming VMs in one VPC so the backend reaches
Apollo's Web UI/API (TCP 47990) over private IPs, and 47990 is never exposed to
the internet. Manage the static infra with Terraform. Prototype scope: no
enterprise hardening.

## Out of Terraform

- **Gaming AMI**: `ami-03ac585d0f18ea3db` (copied from the old account). Passed
  in as a variable so `terraform destroy` can never delete it. Updated by
  baking a new AMI from a builder VM (see "AMI updates").
- **Per-user VMs, game volumes, Elastic IPs**: created at runtime by the
  backend, as today.

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
- No RDP/SSH ingress (admin access via SSM port forwarding).
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
- EC2: Run/Start/Stop/Describe instances, Create/Attach/Describe volumes,
  Allocate/Associate/Describe addresses, CreateTags, and waiter describe calls.
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
- `/etc/cloud-gaming.env` is written by the deploy script (not user data), so
  secrets never land in Terraform state.

## Deploy flow (`infra/scripts/deploy-backend.sh`)

1. Tar the backend source (excluding `node_modules`, `data`, `dist`, `.env`).
2. Upload to the deploy S3 bucket.
3. `aws ssm send-command` on the backend instance: download, extract,
   `npm ci`, `npx prisma generate`, `npx prisma migrate deploy`, `npm run build`,
   restart the service.
4. Env file is uploaded separately (`deploy-backend.sh --env <file>`).

## Backend config changes

- `.env` values come from Terraform outputs: `AWS_AMI_ID`,
  `AWS_SECURITY_GROUP_ID`, `AWS_SUBNET_ID`, `AWS_AVAILABILITY_ZONE`,
  `AWS_IAM_INSTANCE_PROFILE_NAME`.
- `APOLLO_API_USE_PRIVATE_IP=true`.
- `AWS_KEY_NAME` becomes optional (VMs launch without a key pair; admin via SSM).
- Clear stored Apollo credentials when a user's VM is replaced (new VM boots
  with the AMI's default Apollo password).

## AMI updates (`infra/scripts/ami-builder.sh`)

- `start`: launch a builder from the current AMI in the public subnet with the
  gaming VM profile; print the SSM port-forward command for RDP.
- `bake <instance-id> <name>`: `create-image`, wait until available, print ID.
- `cleanup <instance-id>`: terminate the builder.
- Then update `gaming_ami_id` / `AWS_AMI_ID`.

## Follow-ups (not in this change)

- Set Apollo `origin_web_ui_allowed = lan` in the next AMI bake.
- Verify SSM Agent runs on the gaming AMI (first builder launch will show it).
- Old account cleanup (VM, volume, EIP, AMI, root access keys).
