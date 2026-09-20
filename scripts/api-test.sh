#!/usr/bin/env bash
# API tests against a running backend.
#
#   scripts/api-test.sh                 # fast checks only (no AWS resources)
#   scripts/api-test.sh --with-vm       # also start a real VM (~10-15 min, ~$0.60/h)
#   scripts/api-test.sh --cleanup       # delete AWS resources left behind by test users
#
# BASE_URL defaults to the deployed backend from terraform output.
# Test users are test+<run id>@cloud-gaming.test so they are easy to spot and clean up.
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
export AWS_PROFILE=${AWS_PROFILE:-cloud-gaming}
export AWS_REGION=${AWS_REGION:-ap-south-1}
export AWS_PAGER=""
BASE_URL=${BASE_URL:-$(terraform -chdir="$ROOT/infra/terraform" output -raw backend_api_url 2>/dev/null)}
RUN_ID=$(date +%s)
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '       %s\n' "$2"; }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# req METHOD PATH [TOKEN] [JSON] -> sets STATUS and BODY
req() {
  local method=$1
  local path=$2
  local token=${3:-}
  local body=${4:-}
  local args=(-sS -m 120 -X "$method" "$BASE_URL$path" -w '\n%{http_code}')
  [ -n "$token" ] && args+=(-H "authorization: Bearer $token")
  [ -n "$body" ] && args+=(-H 'content-type: application/json' -d "$body")
  local out; out=$(curl "${args[@]}" 2>&1)
  STATUS=$(printf '%s' "$out" | tail -1)
  BODY=$(printf '%s' "$out" | sed '$d')
}

expect_status() { # expect_status EXPECTED DESCRIPTION
  if [ "$STATUS" = "$1" ]; then ok "$2"; else bad "$2" "expected HTTP $1, got $STATUS: $(printf '%s' "$BODY" | head -c 200)"; fi
}

register() { # register EMAIL PASSWORD -> echoes token
  req POST /auth/register "" "{\"email\":\"$1\",\"password\":\"$2\"}"
  printf '%s' "$BODY" | jq -r '.token // empty'
}

# ---------------------------------------------------------------- fast checks
if [ "${1:-}" = "--cleanup" ]; then
  SKIP_TESTS=1
fi

USER_A="test+${RUN_ID}a@cloud-gaming.test"
USER_B="test+${RUN_ID}b@cloud-gaming.test"
PW='TestPassword123'

if [ -z "${SKIP_TESTS:-}" ]; then
section "Health"
req GET /health; expect_status 200 "GET /health returns 200"
[ "$(printf '%s' "$BODY" | jq -r .ok)" = true ] && ok "health body is {ok:true}" || bad "health body is {ok:true}" "$BODY"

section "Auth"
TOKEN_A=$(register "$USER_A" "$PW"); [ -n "$TOKEN_A" ] && ok "register returns a token" || bad "register returns a token" "$BODY"
req POST /auth/register "" "{\"email\":\"$USER_A\",\"password\":\"$PW\"}"; expect_status 409 "duplicate email rejected"
req POST /auth/register "" '{"email":"not-an-email","password":"TestPassword123"}'; expect_status 400 "invalid email rejected"
req POST /auth/register "" "{\"email\":\"test+${RUN_ID}short@cloud-gaming.test\",\"password\":\"short\"}"; expect_status 400 "short password rejected"
req POST /auth/register "" '{"email":"x@y.test"}'; expect_status 400 "missing password rejected"
req POST /auth/login "" "{\"email\":\"$USER_A\",\"password\":\"$PW\"}"; expect_status 200 "login with correct password"
req POST /auth/login "" "{\"email\":\"$USER_A\",\"password\":\"WrongPassword1\"}"; expect_status 401 "login with wrong password rejected"
req POST /auth/login "" "{\"email\":\"nobody+${RUN_ID}@cloud-gaming.test\",\"password\":\"$PW\"}"; expect_status 401 "login as unknown user rejected"

section "Tokens"
req GET /me "$TOKEN_A"; expect_status 200 "GET /me with valid token"
req GET /me ""; expect_status 401 "GET /me without token"
req GET /me "not-a-token"; expect_status 401 "malformed token rejected"
req GET /me "${TOKEN_A}tampered"; expect_status 401 "tampered token rejected"

section "Sessions without a VM"
req GET /sessions/current "$TOKEN_A"; expect_status 404 "GET /sessions/current with no session"
req POST /sessions/stop "$TOKEN_A"; expect_status 404 "POST /sessions/stop with no session"

section "Pairing without a ready VM"
req POST /pairing/link "$TOKEN_A" '{}'; expect_status 409 "POST /pairing/link returns 409"
req POST /pairing/pin "$TOKEN_A" '{"pin":"1234"}'; expect_status 409 "POST /pairing/pin returns 409"
req GET /pairing/clients "$TOKEN_A"; expect_status 409 "GET /pairing/clients returns 409"

section "Validation"
req POST /pairing/pin "$TOKEN_A" '{"pin":"12"}'; expect_status 400 "PIN must be 4 digits"
req POST /pairing/pin "$TOKEN_A" '{"pin":"abcd"}'; expect_status 400 "PIN must be numeric"
req POST /pairing/link "$TOKEN_A" "{\"name\":\"$(printf 'x%.0s' {1..200})\"}"; expect_status 400 "device name length limited"
req POST /auth/login "" 'not json'; expect_status 400 "malformed JSON rejected"

section "User isolation"
TOKEN_B=$(register "$USER_B" "$PW"); [ -n "$TOKEN_B" ] && ok "second user registers" || bad "second user registers" "$BODY"
req GET /me "$TOKEN_B"; [ "$(printf '%s' "$BODY" | jq -r '.id // .userId // empty')" = "$USER_B" ] && ok "/me returns the caller's own identity" || bad "/me returns the caller's own identity" "$BODY"
req GET /sessions/current "$TOKEN_B"; expect_status 404 "user B has no session of their own"

fi   # end fast checks

# ---------------------------------------------------------------- VM checks
if [ "${1:-}" = "--with-vm" ]; then
  section "Full flow with a real VM (user A)"
  req POST /sessions/start "$TOKEN_A" '{}'; expect_status 202 "first start returns 202 accepted"
  SESSION_ID=$(printf '%s' "$BODY" | jq -r .id)

  # Concurrent starts must not create a second VM.
  req POST /sessions/start "$TOKEN_A" '{}' & req POST /sessions/start "$TOKEN_A" '{}' & wait
  req GET /sessions/current "$TOKEN_A"
  [ "$(printf '%s' "$BODY" | jq -r .id)" = "$SESSION_ID" ] && ok "concurrent starts reuse the same session" || bad "concurrent starts reuse the same session" "$BODY"

  printf '  waiting for the VM to become ready'
  for _ in $(seq 1 60); do
    req GET /sessions/current "$TOKEN_A"; ST=$(printf '%s' "$BODY" | jq -r .status)
    [ "$ST" = ready ] || [ "$ST" = failed ] && break
    printf '.'; sleep 20
  done
  printf '\n'
  [ "$ST" = ready ] && ok "session reaches ready" || bad "session reaches ready" "$BODY"
  INSTANCE_ID=$(printf '%s' "$BODY" | jq -r .instanceId); PUBLIC_IP=$(printf '%s' "$BODY" | jq -r .publicIp)

  if [ "$ST" = ready ]; then
    COUNT=$(aws ec2 describe-instances --filters "Name=tag:UserId,Values=$USER_A" Name=instance-state-name,Values=pending,running,stopping,stopped --query 'length(Reservations[].Instances[])' --output text)
    [ "$COUNT" = 1 ] && ok "exactly one VM exists for the user" || bad "exactly one VM exists for the user" "found $COUNT"

    VOL=$(aws ec2 describe-volumes --filters "Name=tag:UserId,Values=$USER_A" --query 'Volumes[0].[VolumeId,Size,Attachments[0].Device]' --output text)
    [ -n "$VOL" ] && ok "game volume created and attached: $VOL" || bad "game volume created and attached" "none found"

    req POST /pairing/link "$TOKEN_A" '{"name":"TestPhone"}'; expect_status 200 "POST /pairing/link returns a link"
    LINK=$(printf '%s' "$BODY" | jq -r .link)
    printf '%s' "$LINK" | grep -Eq "^art://$PUBLIC_IP:47989\?pin=[0-9]{4}&passphrase=[0-9a-f]{8}&name=" \
      && ok "link has the expected art:// shape" || bad "link has the expected art:// shape" "$LINK"

    req GET /pairing/clients "$TOKEN_A"; expect_status 200 "GET /pairing/clients works on a ready VM"

    D_DRIVE=$(aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunPowerShellScript \
      --parameters '{"commands":["(Get-Volume -DriveLetter D -ErrorAction SilentlyContinue).FileSystemLabel; Test-Path D:\\SteamLibrary"]}' \
      --query Command.CommandId --output text 2>/dev/null)
    if [ -n "$D_DRIVE" ]; then
      for _ in $(seq 1 30); do
        CST=$(aws ssm get-command-invocation --command-id "$D_DRIVE" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null)
        [ "$CST" != Pending ] && [ "$CST" != InProgress ] && break; sleep 4
      done
      OUT=$(aws ssm get-command-invocation --command-id "$D_DRIVE" --instance-id "$INSTANCE_ID" --query StandardOutputContent --output text 2>/dev/null)
      printf '%s' "$OUT" | grep -q Games && ok "game volume is formatted and mounted as D: (Games)" || bad "game volume is formatted and mounted as D:" "$OUT"
      printf '%s' "$OUT" | grep -qi true && ok "D:\\SteamLibrary exists" || bad "D:\\SteamLibrary exists" "$OUT"
    fi

    section "Stop and restart"
    req POST /sessions/stop "$TOKEN_A"; expect_status 200 "stop returns 200"
    [ "$(printf '%s' "$BODY" | jq -r .status)" = stopped ] && ok "session status is stopped" || bad "session status is stopped" "$BODY"
    aws ec2 wait instance-stopped --instance-ids "$INSTANCE_ID" && ok "VM actually stopped in AWS" || bad "VM actually stopped in AWS"

    req POST /sessions/start "$TOKEN_A" '{}'
    printf '  waiting for restart'
    for _ in $(seq 1 60); do
      req GET /sessions/current "$TOKEN_A"; ST=$(printf '%s' "$BODY" | jq -r .status)
      [ "$ST" = ready ] || [ "$ST" = failed ] && break
      printf '.'; sleep 15
    done
    printf '\n'
    [ "$ST" = ready ] && ok "restart reaches ready" || bad "restart reaches ready" "$BODY"
    [ "$(printf '%s' "$BODY" | jq -r .instanceId)" = "$INSTANCE_ID" ] && ok "restart reuses the same VM" || bad "restart reuses the same VM" "$BODY"
    [ "$(printf '%s' "$BODY" | jq -r .publicIp)" = "$PUBLIC_IP" ] && ok "restart keeps the same public IP" || bad "restart keeps the same public IP" "$BODY"

    section "Known gap: start while stopping"
    req POST /sessions/stop "$TOKEN_A" >/dev/null
    req POST /sessions/start "$TOKEN_A" '{}'
    printf '  polling'
    for _ in $(seq 1 30); do
      req GET /sessions/current "$TOKEN_A"; ST=$(printf '%s' "$BODY" | jq -r .status)
      [ "$ST" = ready ] || [ "$ST" = failed ] && break
      printf '.'; sleep 15
    done
    printf '\n'
    if [ "$ST" = ready ]; then ok "start during stopping recovered"; else
      bad "start during stopping recovered" "status=$ST error=$(printf '%s' "$BODY" | jq -r .error)"; fi

    req POST /sessions/stop "$TOKEN_A" >/dev/null 2>&1
  fi
fi

# ---------------------------------------------------------------- cleanup
if [ "${1:-}" = "--cleanup" ]; then
  section "Cleaning up AWS resources of test users"
  for ID in $(aws ec2 describe-instances --filters 'Name=tag:UserId,Values=test+*,sectest+*' Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[].Instances[].InstanceId' --output text); do
    aws ec2 terminate-instances --instance-ids "$ID" >/dev/null && echo "  terminated $ID"
    aws ec2 wait instance-terminated --instance-ids "$ID"
  done
  for V in $(aws ec2 describe-volumes --filters 'Name=tag:UserId,Values=test+*,sectest+*' Name=status,Values=available --query 'Volumes[].VolumeId' --output text); do
    aws ec2 delete-volume --volume-id "$V" >/dev/null && echo "  deleted volume $V"
  done
  for A in $(aws ec2 describe-addresses --filters 'Name=tag:UserId,Values=test+*,sectest+*' --query 'Addresses[].AllocationId' --output text); do
    aws ec2 release-address --allocation-id "$A" >/dev/null && echo "  released EIP $A"
  done
  echo "  (test user rows stay in the backend database)"
fi

printf '\n\033[1m%d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
