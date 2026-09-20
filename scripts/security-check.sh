#!/usr/bin/env bash
# Security checks for the deployed stack.
#
#   scripts/security-check.sh            # config checks only (no AWS resources)
#   scripts/security-check.sh --with-vm  # also starts a gaming VM and probes its ports
#
# Verifies the thing the VPC work was for: Apollo's web UI/API (47990) must not be
# reachable from the internet, while the streaming ports must be.
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
export AWS_PROFILE=${AWS_PROFILE:-cloud-gaming}
export AWS_REGION=${AWS_REGION:-ap-south-1}
export AWS_PAGER=""
TF() { terraform -chdir="$ROOT/infra/terraform" output -raw "$1" 2>/dev/null; }
BASE_URL=${BASE_URL:-$(TF backend_api_url)}
PASS=0; FAIL=0; WARN=0

ok()      { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()     { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '       %s\n' "$2"; }
warn()    { WARN=$((WARN+1)); printf '  \033[33mWARN\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '       %s\n' "$2"; }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

port_open() { nc -z -G 4 -w 4 "$1" "$2" >/dev/null 2>&1; }

section "Security group rules"
GSG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=cloud-gaming-vm --query 'SecurityGroups[0].GroupId' --output text)
BSG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=cloud-gaming-backend --query 'SecurityGroups[0].GroupId' --output text)
RULES=$(aws ec2 describe-security-group-rules --filters "Name=group-id,Values=$GSG" --query 'SecurityGroupRules[?!IsEgress].[FromPort,ToPort,IpProtocol,CidrIpv4,ReferencedGroupInfo.GroupId]' --output text)
printf '%s\n' "$RULES" | awk '$1==47990 && $4=="None"' | grep -q . && ok "gaming SG: 47990 only from another SG, not a CIDR" || bad "gaming SG: 47990 restricted" "$RULES"
printf '%s\n' "$RULES" | awk '$1==47990 && $5!="None"' | grep -q "$BSG" && ok "gaming SG: 47990 source is the backend SG" || bad "gaming SG: 47990 source is the backend SG" "$RULES"
for p in 47984 47989 48010; do
  printf '%s\n' "$RULES" | awk -v p=$p '$1==p && $4=="0.0.0.0/0"' | grep -q . && ok "gaming SG: streaming port $p open to clients" || bad "gaming SG: streaming port $p open" "$RULES"
done
printf '%s\n' "$RULES" | awk '$1==3389 || $1==22' | grep -q . && bad "gaming SG: no RDP/SSH rule" "RDP or SSH is open" || ok "gaming SG: no RDP/SSH rule"

BRULES=$(aws ec2 describe-security-group-rules --filters "Name=group-id,Values=$BSG" --query 'SecurityGroupRules[?!IsEgress].[FromPort,ToPort,IpProtocol,CidrIpv4]' --output text)
printf '%s\n' "$BRULES" | awk '$1==22' | grep -q . && bad "backend SG: no SSH rule" "$BRULES" || ok "backend SG: no SSH rule"
printf '%s\n' "$BRULES" | awk '$1==8080' | grep -q . && ok "backend SG: API port 8080 present" || bad "backend SG: API port 8080 present" "$BRULES"
printf '%s\n' "$BRULES" | awk '$1==8080 && $4=="0.0.0.0/0"' | grep -q . && warn "backend API is open to the whole internet" "set api_allowed_cidr to your IP if you want it private"

section "Secrets and storage"
for P in /cloud-gaming/auth-token-secret /cloud-gaming/apollo-api-password; do
  T=$(aws ssm get-parameter --name $P --query 'Parameter.Type' --output text 2>/dev/null)
  [ "$T" = SecureString ] && ok "SSM $P is a SecureString" || bad "SSM $P is a SecureString" "type=$T"
done
BUCKET=$(TF deploy_bucket)
PAB=$(aws s3api get-public-access-block --bucket "$BUCKET" --query 'PublicAccessBlockConfiguration.[BlockPublicAcls,BlockPublicPolicy,IgnorePublicAcls,RestrictPublicBuckets]' --output text)
[ "$PAB" = "True	True	True	True" ] && ok "deploy bucket blocks all public access" || bad "deploy bucket blocks all public access" "$PAB"
aws s3api get-bucket-policy --bucket "$BUCKET" >/dev/null 2>&1 && warn "deploy bucket has a bucket policy; check it" || ok "deploy bucket has no bucket policy"

section "Instance hardening"
BID=$(TF backend_instance_id)
IMDS=$(aws ec2 describe-instances --instance-ids "$BID" --query 'Reservations[0].Instances[0].MetadataOptions.HttpTokens' --output text)
[ "$IMDS" = required ] && ok "backend requires IMDSv2" || bad "backend requires IMDSv2" "HttpTokens=$IMDS"
LT_IMDS=$(aws ec2 describe-launch-template-versions --launch-template-name cloud-gaming-vm --versions '$Default' --query 'LaunchTemplateVersions[0].LaunchTemplateData.MetadataOptions.HttpTokens' --output text)
[ "$LT_IMDS" = required ] && ok "gaming VMs require IMDSv2" || warn "gaming VMs allow IMDSv1" "a compromised game/browser could read instance credentials via metadata"
KEY=$(aws ec2 describe-launch-template-versions --launch-template-name cloud-gaming-vm --versions '$Default' --query 'LaunchTemplateVersions[0].LaunchTemplateData.KeyName' --output text)
[ "$KEY" = None ] && ok "gaming VMs launch without an SSH key pair" || warn "gaming VMs use key pair $KEY"

section "API authentication"
for EP in "GET /me" "GET /sessions/current" "POST /sessions/start" "POST /sessions/stop" "POST /pairing/link" "POST /pairing/pin" "GET /pairing/clients"; do
  M=${EP%% *}; P=${EP#* }
  CODE=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -X "$M" "$BASE_URL$P" -H 'content-type: application/json' -d '{}' 2>/dev/null)
  [ "$CODE" = 401 ] && ok "$EP requires a token" || bad "$EP requires a token" "got HTTP $CODE"
done
CODE=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$BASE_URL/health" 2>/dev/null)
[ "$CODE" = 200 ] && ok "GET /health is public (intended)" || warn "GET /health returned $CODE"
printf '  note: API is plain HTTP; tokens and passwords travel unencrypted\n'
WARN=$((WARN+1))

if [ "${1:-}" = "--with-vm" ]; then
  section "Live port probe against a gaming VM"
  EMAIL="sectest+$(date +%s)@cloud-gaming.test"
  TOKEN=$(curl -sS -m 30 -X POST "$BASE_URL/auth/register" -H 'content-type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"SecurityTest123\"}" | jq -r .token)
  curl -sS -m 60 -X POST "$BASE_URL/sessions/start" -H "authorization: Bearer $TOKEN" >/dev/null
  printf '  waiting for the VM'
  for _ in $(seq 1 60); do
    R=$(curl -sS -m 20 "$BASE_URL/sessions/current" -H "authorization: Bearer $TOKEN")
    ST=$(printf '%s' "$R" | jq -r .status); [ "$ST" = ready ] || [ "$ST" = failed ] && break
    printf '.'; sleep 20
  done
  printf '\n'
  IP=$(printf '%s' "$R" | jq -r .publicIp)
  if [ "$ST" != ready ]; then
    bad "VM became ready for the probe" "$R"
  else
    ok "test VM ready at $IP"
    port_open "$IP" 47990 && bad "Apollo web UI (47990) is NOT reachable from the internet" "it answered on $IP:47990" || ok "Apollo web UI (47990) is not reachable from the internet"
    for p in 47984 47989 48010; do
      port_open "$IP" $p && ok "streaming port $p reachable from the internet" || bad "streaming port $p reachable" "no answer on $IP:$p"
    done
    for p in 3389 22 445 5985; do
      port_open "$IP" $p && bad "port $p (admin) is closed" "it answered on $IP:$p" || ok "port $p (admin) is closed"
    done
    # curl prints 000 when it never got a response, which is what we want here.
    CODE=$(curl -sS -k -m 8 -o /dev/null -w '%{http_code}' "https://$IP:47990/" 2>/dev/null)
    [ -z "$CODE" ] || [ "$CODE" = 000 ] && ok "Apollo web UI does not answer HTTPS from the internet" || bad "Apollo web UI answered from the internet" "HTTP $CODE"
    curl -sS -m 60 -X POST "$BASE_URL/sessions/stop" -H "authorization: Bearer $TOKEN" >/dev/null
    printf '  stopped the test VM (run scripts/api-test.sh --cleanup to delete it)\n'
  fi
fi

printf '\n\033[1m%d passed, %d failed, %d warnings\033[0m\n' "$PASS" "$FAIL" "$WARN"
[ "$FAIL" -eq 0 ]
