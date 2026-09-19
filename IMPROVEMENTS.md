# Cloud Gaming Improvements

Priority list for turning the current MVP into a safer, more reliable cloud gaming service.

## 1. Lock Down Apollo Web UI/API Access

Current state: Apollo Web UI/API on `47990` can be opened from the internet if `origin_web_ui_allowed = wan` and the security group allows it.

Better target:

- Run the backend in the same VPC as the gaming VMs.
- Call Apollo through the VM private IP, not public IP.
- Set `APOLLO_API_USE_PRIVATE_IP=true` on the deployed backend.
- Set Apollo config back to:
  ```text
  origin_web_ui_allowed = lan
  ```
- Security group should allow TCP `47990` only from the backend security group.
- Do not expose Apollo Web UI publicly to users.

Impact: high. This removes the biggest obvious security risk.

## 2. Use Unique Apollo Credentials Per VM

Current state: all VMs can share `apollo / apollo` if that was baked into the AMI.

Better target:

- On first boot, generate a random Apollo password per VM.
- Store it in the backend DB, encrypted.
- Backend uses that per-VM password for `/api/login` and `/api/pin`.
- Users never see Apollo credentials.

Impact: high. One leaked password should not unlock every VM.

## 3. Add a Backend-Only Apollo Pairing API

Current state: backend logs into Apollo Web UI, gets an auth cookie, then calls `/api/pin`.

Better target:

- Patch Apollo with a cloud-only endpoint, for example:
  ```text
  POST /api/cloud/pin
  ```
- Authenticate it with a backend secret or signed request.
- Keep this endpoint inaccessible from the public internet.

Impact: high, but requires Apollo changes and AMI update. Cleaner than automating Web UI login.

## 4. Improve Session State Handling

Current state: sessions are stored in SQLite and refreshed from EC2 in some paths.

Better target:

- Treat VM state as authoritative from AWS.
- If EC2 is `running`, session can become `ready`.
- If EC2 is `pending`, session should be `starting`.
- If EC2 is `stopped`, session should be `stopped`.
- Prevent duplicate active sessions per user at the DB level.

Impact: high. Avoids confusing state when a VM is started/stopped outside the backend.

## 5. Make Start/Stop Fully Async

Current state: start is backgrounded, stop still waits for AWS stop call.

Better target:

- `POST /sessions/start` returns immediately with `starting`.
- `POST /sessions/stop` returns immediately with `stopping`.
- Backend worker updates state later.
- Client polls `GET /sessions/current`, or later uses WebSocket/SSE.

Impact: medium-high. Better UX when AWS takes time.

## 6. Add Readiness Checks Beyond EC2 Running

Current state: `running` means the VM exists, but Apollo may not be ready yet.

Better target:

- After EC2 is running, poll:
  ```text
  https://<vm>:47990/api/login
  ```
  or a lighter health endpoint if we add one.
- Mark session `ready` only after Apollo responds.
- Return useful status like `booting`, `apollo_starting`, `ready`.

Impact: medium-high. Prevents users from pairing too early.

## 7. Restrict Security Group Ports

Current state: security group was broad during testing.

Better target:

- Streaming ports open only as needed:
  - TCP `47984`
  - TCP `47989`
  - TCP `47990` only from backend, not public
  - TCP `48010`
  - UDP `47998-48000`
- RDP/SSH/admin access only from trusted IPs.

Impact: high for security.

## 8. Persist Game Storage Safely

Current state: each user gets a persistent 140 GB EBS game volume.

Better target:

- Enforce one game volume per user.
- Tag volumes with user ID and environment.
- Snapshot volumes before risky operations.
- Add cleanup tooling for orphaned volumes.
- Decide whether game volume remains attached while VM is stopped.

Impact: medium-high. Prevents data loss and unexpected AWS costs.

## 9. Add Cost Controls

Current state: user can keep VM running until stopped manually/API.

Better target:

- Idle timeout.
- Max session duration.
- Auto-stop failed/abandoned VMs.
- Periodic job to find running instances without active sessions.
- AWS budget alarms.

Impact: high for real usage.

## 10. Move From Local SQLite to Managed DB

Current state: SQLite is fine for local MVP.

Better target:

- Use Postgres for deployed backend.
- Keep Prisma.
- Add migrations in CI/deploy.
- Keep SQLite only for local dev.

Impact: medium. Needed once backend is not single-machine local.

## 11. Improve Auth

Current state: local email/password with custom HMAC token.

Better target:

- Add change-password endpoint.
- Add refresh tokens or shorter access-token expiry.
- Add password reset.
- Add rate limiting on login.
- Consider managed auth later.

Impact: medium.

## 12. Build a Cleaner Client Contract

Current state: client calls start/current/pin/stop directly.

Better target:

- Return a single state object:
  ```json
  {
    "status": "ready",
    "host": "65.0.136.108",
    "pairingRequired": true,
    "streamingPorts": [47984, 47989, 48010],
    "udpPorts": ["47998-48000"]
  }
  ```
- Hide backend/Apollo implementation details from the client.

Impact: medium. Makes Artemis/mobile integration easier later.

## 13. Tag and Audit AWS Resources

Better target:

- Tag every resource:
  - `UserId`
  - `Service=cloud-gaming`
  - `Environment`
  - `ManagedBy=backend`
- Log every lifecycle action:
  - create VM
  - start VM
  - stop VM
  - attach volume
  - pair PIN

Impact: medium. Makes debugging and cleanup much easier.

## 14. Add Deployment Setup

Better target:

- Dockerfile for backend.
- Environment-specific config.
- Run backend on ECS/Fargate, EC2, or another small server.
- Backend IAM role with least privilege.
- No root AWS credentials.

Impact: medium-high. Needed before real users.

## 15. Apollo WAN Streaming Improvements

Separate from backend control plane, Apollo itself can still be improved for WAN:

- Keep the packet pacing fix.
- Add better network stats exported to backend.
- Explore adaptive bitrate with Artemis/Apollo support.
- Tune FEC/overhead handling for WAN.
- Add structured metrics around jitter, drops, frame queue, and packet pacing.

Impact: high for stream quality, but separate from VM orchestration.
