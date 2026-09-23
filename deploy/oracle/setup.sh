#!/usr/bin/env bash
# Sets up a k8n demo on a fresh Oracle Cloud "Always Free" Ampere VM (Ubuntu,
# arm64): a throwaway k3s cluster, k8n as a service bound to localhost, and
# Tailscale in front, so the demo is reachable only by people you share the
# machine with. Nothing is opened to the internet.
#
#   curl -fsSLO https://raw.githubusercontent.com/pulk17/k8n/main/deploy/oracle/setup.sh
#   bash setup.sh            # the version defaults to v0.9.0; pass another to pin it
#
# Whoever you share this machine with can do anything to its cluster, and
# through a privileged pod, to the VM itself. Keep nothing else on it.
set -euo pipefail

VERSION="${1:-v0.9.0}"
PORT=8080
BIN=/usr/local/bin/k8n

echo "== k3s: a single-node cluster to show k8n on"
if ! command -v k3s >/dev/null; then
  curl -sfL https://get.k3s.io | sudo sh -s - --write-kubeconfig-mode 600
fi
sudo mkdir -p /var/lib/k8n/.kube
sudo cp /etc/rancher/k3s/k3s.yaml /var/lib/k8n/.kube/config

echo "== k8n $VERSION"
tmp=$(mktemp -d)
base="https://github.com/pulk17/k8n/releases/download/$VERSION"
curl -fsSL -o "$tmp/k8n-linux-arm64" "$base/k8n-linux-arm64"
curl -fsSL -o "$tmp/SHA256SUMS.txt" "$base/SHA256SUMS.txt"
(cd "$tmp" && grep ' k8n-linux-arm64$' SHA256SUMS.txt | sha256sum -c -)
sudo install -m 0755 "$tmp/k8n-linux-arm64" "$BIN"
rm -rf "$tmp"

echo "== Tailscale: the only way in"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
sudo tailscale up   # prints a login link the first time
host=$(sudo tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')

echo "== k8n as a service, on localhost only"
id k8n >/dev/null 2>&1 || sudo useradd --system --home /var/lib/k8n --shell /usr/sbin/nologin k8n
sudo chown -R k8n:k8n /var/lib/k8n
sudo tee /etc/systemd/system/k8n.service >/dev/null <<UNIT
[Unit]
Description=k8n
After=network-online.target k3s.service

[Service]
User=k8n
Environment=HOME=/var/lib/k8n
Environment=KUBECONFIG=/var/lib/k8n/.kube/config
Environment=API_HOST=127.0.0.1
# The page is served from the Tailscale name, so its requests carry that origin.
Environment=ALLOWED_ORIGINS=https://$host
ExecStart=$BIN --port $PORT
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now k8n
sudo tailscale serve --bg "$PORT"

sleep 3
token=$(sudo cat /var/lib/k8n/.k8n/token)
cat <<DONE

  k8n is up, reachable only inside your tailnet:

    https://$host/?t=$token

  Share this machine (not your whole tailnet) with the demo user from the
  Tailscale admin console — Machines, this VM, Share — and send them that link.
  To shut the demo: sudo systemctl stop k8n && sudo tailscale serve reset
DONE
