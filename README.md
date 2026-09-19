# Cloud Gaming Backend

MVP backend for one-user-to-one-VM cloud gaming with Apollo on AWS.

For now, Artemis still initiates pairing. This service starts/stops the user's VM, submits the Artemis PIN to Apollo, and grants the paired device full Apollo permissions.

## Current AWS Defaults

```text
Region: ap-south-1
AMI: ami-04fe85ad48985c7e7
Instance type: g4dn.xlarge
Key pair: Gaming
Security group: sg-0b0cd0139dbf5796e
Root disk: 50 GiB from AMI
Per-user game disk: 140 GiB EBS volume
```

## Flow

```text
POST /auth/login
  returns a backend bearer token

POST /sessions/start
  starts the user's persistent EC2 VM
  creates/attaches user game volume if missing
  returns starting or ready session

GET /sessions/current
  returns current VM/session status

POST /pairing/pin
  submits the Artemis/Moonlight PIN to Apollo on the ready VM
  grants full Apollo permissions to the paired Artemis device

GET /pairing/clients
  returns Apollo paired clients and permission masks for the ready VM

POST /sessions/stop
  stops the user's persistent VM
  keeps the user's game volume attached
```

The user's game disk is persistent. The EC2 VM is persistent and should normally be stopped, not terminated.

Important AWS rule: an EBS volume can only attach to an EC2 instance in the same Availability Zone. `AWS_AVAILABILITY_ZONE` must match the launch template's subnet AZ (both come from Terraform).

## Run Locally

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Use your normal AWS credentials locally. Do not put secret keys in `.env`.

If using a profile:

```bash
AWS_PROFILE=default npm run dev
```

Apollo requirements for local testing:

- Apollo Web UI/API must be reachable on TCP `47990`.
- On the VM, Apollo config must allow WAN Web UI access while the backend runs outside AWS:
  ```text
  origin_web_ui_allowed = wan
  ```
- `.env` must contain Apollo Web UI credentials:
  ```text
  APOLLO_API_USERNAME=apollo
  APOLLO_API_PASSWORD=apollo
  ```
  These are treated as AMI default credentials. When the backend first reaches a VM, it rotates Apollo to a random per-VM password and stores that for future API calls.

Production should not expose Apollo Web UI publicly. Run the backend in the same VPC, call Apollo over private IP, set `origin_web_ui_allowed = lan`, and restrict TCP `47990` to the backend security group.

When the backend is deployed inside the AWS VPC, set:

```text
APOLLO_API_USE_PRIVATE_IP=true
```

Local Mac testing should leave it as:

```text
APOLLO_API_USE_PRIVATE_IP=false
```

## API Examples

Login:

```bash
curl -X POST http://localhost:8080/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"swanandmathekar@gmail.com","password":"<password>"}'
```

Start:

```bash
curl -X POST http://localhost:8080/sessions/start \
  -H "authorization: Bearer $TOKEN"
```

Status:

```bash
curl http://localhost:8080/sessions/current \
  -H "authorization: Bearer $TOKEN"
```

Stop:

```bash
curl -X POST http://localhost:8080/sessions/stop \
  -H "authorization: Bearer $TOKEN"
```

Submit Artemis PIN:

```bash
curl -X POST http://localhost:8080/pairing/pin \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"pin":"1234","name":"Artemis"}'
```

List Apollo paired clients:

```bash
curl http://localhost:8080/pairing/clients \
  -H "authorization: Bearer $TOKEN"
```

## Apollo Pairing Details

Apollo's current code uses Web UI cookie auth for protected endpoints. The backend handles this internally:

```text
POST /api/login
  -> Set-Cookie: auth=...

POST /api/password
  Cookie: auth=...
  -> rotates the AMI default Apollo password to a VM-specific password

POST /api/pin
  Cookie: auth=...
```

Apollo gives full permissions only to the first paired device. Later paired devices get limited permissions by default. After a successful PIN submit, the backend calls:

```text
GET /api/clients/list
POST /api/clients/update
```

and upgrades the matching Artemis device to full permissions.

## Public vs Private IPs

The backend tracks both:

- `publicIp`: used by Artemis to connect to the VM.
- `privateIp`: used by the deployed backend to call Apollo Web UI/API inside the VPC.

For local testing, `/pairing/pin` calls Apollo through the public IP because the backend runs on your Mac.

For deployment, `/pairing/pin` should call Apollo through the private IP by setting `APOLLO_API_USE_PRIVATE_IP=true`. Then TCP `47990` does not need to be public.
