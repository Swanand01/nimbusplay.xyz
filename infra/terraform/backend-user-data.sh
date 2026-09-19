#!/bin/bash
# One-time bootstrap for the backend host (Amazon Linux 2023, arm64).
# App code and /etc/cloud-gaming.env are delivered later by infra/scripts/deploy-backend.sh.
set -euxo pipefail

dnf install -y tar xz

# Node 22 LTS from nodejs.org, checksum-verified.
cd /tmp
NODE_TARBALL=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/linux-arm64\.tar\.xz$/ {print $2}')
curl -fsSLO "https://nodejs.org/dist/latest-v22.x/${NODE_TARBALL}"
curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep " ${NODE_TARBALL}\$" | sha256sum -c -
tar -xJf "${NODE_TARBALL}" -C /usr/local --strip-components=1
rm -f "${NODE_TARBALL}"

useradd --system --home-dir /opt/cloud-gaming --shell /sbin/nologin cloudgaming || true
mkdir -p /opt/cloud-gaming/app /opt/cloud-gaming/data
chown -R cloudgaming:cloudgaming /opt/cloud-gaming

cat > /etc/systemd/system/cloud-gaming.service <<'UNIT'
[Unit]
Description=Cloud gaming backend
After=network-online.target
Wants=network-online.target
ConditionPathExists=/etc/cloud-gaming.env
ConditionPathExists=/opt/cloud-gaming/app/dist/server.js

[Service]
User=cloudgaming
WorkingDirectory=/opt/cloud-gaming/app
EnvironmentFile=/etc/cloud-gaming.env
ExecStart=/usr/local/bin/node dist/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable cloud-gaming.service
