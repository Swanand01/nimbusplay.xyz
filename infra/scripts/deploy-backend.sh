#!/usr/bin/env bash
# Deploy the backend to the EC2 host created by infra/terraform, via S3 + SSM (no SSH).
#
#   infra/scripts/deploy-backend.sh                       # deploy committed HEAD
#   infra/scripts/deploy-backend.sh --env .env.production # also install new (non-secret) config
#
# Deploys `git archive HEAD`, so uncommitted changes are not shipped.
#
# Secrets live in SSM Parameter Store (SecureString) and never pass through this
# script, S3 or command output. The host fetches them with its instance role and
# writes /etc/cloud-gaming.env = non-secret config + secrets. See SECRETS below.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TF_DIR="$ROOT/infra/terraform"
export AWS_PROFILE=${AWS_PROFILE:-cloud-gaming}
export AWS_REGION=${AWS_REGION:-ap-south-1}
export AWS_PAGER=""

ENV_FILE=""
if [[ "${1:-}" == "--env" ]]; then
  ENV_FILE=${2:?usage: deploy-backend.sh [--env <file>]}
  [[ -f "$ENV_FILE" ]] || { echo "Env file not found: $ENV_FILE" >&2; exit 1; }
fi

# ENV_VAR=parameter-name pairs, fetched on the host from /cloud-gaming/<parameter-name>.
SECRETS="AUTH_TOKEN_SECRET=auth-token-secret APOLLO_API_PASSWORD=apollo-api-password"

if [[ -n "$ENV_FILE" ]]; then
  for pair in $SECRETS; do
    if grep -Eq "^${pair%%=*}=.+" "$ENV_FILE"; then
      echo "$ENV_FILE sets ${pair%%=*}; secrets belong in SSM (/cloud-gaming/${pair#*=}), not the env file." >&2
      exit 1
    fi
  done
fi

INSTANCE_ID=$(terraform -chdir="$TF_DIR" output -raw backend_instance_id)
BUCKET=$(terraform -chdir="$TF_DIR" output -raw deploy_bucket)
REV=$(git -C "$ROOT" rev-parse --short HEAD)
KEY="releases/backend-$REV-$(date +%Y%m%d%H%M%S).tar.gz"

if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
  echo "Warning: uncommitted changes are NOT included (deploying $REV)." >&2
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git -C "$ROOT" archive --format=tar.gz -o "$TMP/app.tar.gz" HEAD
aws s3 cp --only-show-errors "$TMP/app.tar.gz" "s3://$BUCKET/$KEY"

ENV_STEP=""
if [[ -n "$ENV_FILE" ]]; then
  aws s3 cp --only-show-errors "$ENV_FILE" "s3://$BUCKET/env/cloud-gaming.env"
  ENV_STEP="aws s3 cp --only-show-errors s3://$BUCKET/env/cloud-gaming.env /etc/cloud-gaming.config.env && chmod 600 /etc/cloud-gaming.config.env && aws s3 rm --only-show-errors s3://$BUCKET/env/cloud-gaming.env"
fi

read -r -d '' REMOTE <<SCRIPT || true
set -euxo pipefail
export PATH=/usr/local/bin:\$PATH HOME=/root
cloud-init status --wait >/dev/null || true   # first deploy may race the Node install in user data
$ENV_STEP
test -f /etc/cloud-gaming.config.env || { echo 'Missing /etc/cloud-gaming.config.env; rerun with --env <file>'; exit 1; }
set +x   # never trace secret values
umask 077
{
  cat /etc/cloud-gaming.config.env
  for pair in $SECRETS; do
    value=\$(aws ssm get-parameter --region $AWS_REGION --with-decryption --name "/cloud-gaming/\${pair#*=}" --query Parameter.Value --output text)
    echo "\${pair%%=*}=\$value"
  done
} > /etc/cloud-gaming.env.tmp
mv /etc/cloud-gaming.env.tmp /etc/cloud-gaming.env
echo "Wrote /etc/cloud-gaming.env (config + secrets from SSM)"
set -x
rm -rf /opt/cloud-gaming/release && mkdir -p /opt/cloud-gaming/release
aws s3 cp --only-show-errors s3://$BUCKET/$KEY /tmp/app.tar.gz
tar -xzf /tmp/app.tar.gz -C /opt/cloud-gaming/release
cd /opt/cloud-gaming/release
npm ci --no-audit --no-fund
npx prisma generate
set -a; . /etc/cloud-gaming.config.env; set +a   # non-secret config only (DATABASE_URL for migrations)
npx prisma migrate deploy
npm run build
chown -R cloudgaming:cloudgaming /opt/cloud-gaming
systemctl stop cloud-gaming || true
rm -rf /opt/cloud-gaming/app && mv /opt/cloud-gaming/release /opt/cloud-gaming/app
systemctl start cloud-gaming
sleep 3
systemctl is-active cloud-gaming
curl -fsS http://127.0.0.1:\${PORT:-8080}/health
SCRIPT

PARAMS=$(jq -n --arg script "$REMOTE" '{commands: [$script], executionTimeout: ["1200"]}')
COMMAND_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "deploy $REV" \
  --parameters "$PARAMS" \
  --query Command.CommandId --output text)

echo "Deploying $REV to $INSTANCE_ID (SSM command $COMMAND_ID)..."
while true; do
  STATUS=$(aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$STATUS" in
    Pending|InProgress|Delayed) sleep 5 ;;
    *) break ;;
  esac
done

aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query '[StandardOutputContent, StandardErrorContent]' --output text | tail -40
echo "Status: $STATUS"
[[ "$STATUS" == "Success" ]]
