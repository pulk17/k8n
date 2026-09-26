#!/usr/bin/env bash
# Sets up the public k8n demo on a fresh Oracle Cloud "Always Free" VM (Ubuntu
# 24.04, Ampere/arm64 or x86): a k3s cluster, a sandboxed visitor account on it,
# and k8n-demo, the front door that queues visitors and gives each one a clean
# cluster and a fresh k8n in turn. Tailscale Funnel publishes the front door
# over HTTPS; nothing else is reachable from the internet.
#
#   curl -fsSLO https://raw.githubusercontent.com/pulk17/k8n/main/deploy/oracle/setup.sh
#   bash setup.sh            # installs v0.9.1; pass another version to pin it
#
# Safe to run again: it converges rather than repeats.
set -euo pipefail

VERSION="${1:-v0.9.1}"
STATE=/var/lib/k8n
case "$(uname -m)" in aarch64 | arm64) ARCH=arm64 ;; *) ARCH=amd64 ;; esac

echo "== user and state directory"
id k8n >/dev/null 2>&1 || sudo useradd --system --home "$STATE" --shell /usr/sbin/nologin k8n
sudo mkdir -p "$STATE"

echo "== firewall"
# Oracle's image rejects everything but SSH in iptables, pods included: let
# the cluster's own traffic through.
for rule in "INPUT -i cni0" "FORWARD -i cni0" "FORWARD -o cni0"; do
  sudo iptables -C $rule -j ACCEPT 2>/dev/null || sudo iptables -I $rule -j ACCEPT
done
# Visitors' pods may talk to each other and to the cluster, not the internet
# (10.0.0.0/8 covers pods, services and the VM's own network) and not Oracle's
# metadata service. Images still download: containerd pulls from the host.
sudo iptables -t mangle -C PREROUTING -i cni0 ! -d 10.0.0.0/8 -j DROP 2>/dev/null ||
  sudo iptables -t mangle -I PREROUTING -i cni0 ! -d 10.0.0.0/8 -j DROP
# Nor may k8n itself fetch the metadata service (a chart URL, an AI endpoint).
sudo iptables -C OUTPUT -d 169.254.169.254 -p tcp --dport 80 -m owner --uid-owner k8n -j REJECT 2>/dev/null ||
  sudo iptables -I OUTPUT -d 169.254.169.254 -p tcp --dport 80 -m owner --uid-owner k8n -j REJECT
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save >/dev/null; fi

echo "== k3s"
sudo mkdir -p /etc/rancher/k3s
# Pod security "baseline" everywhere but kube-system: no privileged pods, host
# paths, host network or host ports.
sudo tee /etc/rancher/k3s/psa.yaml >/dev/null <<'YAML'
apiVersion: apiserver.config.k8s.io/v1
kind: AdmissionConfiguration
plugins:
  - name: PodSecurity
    configuration:
      apiVersion: pod-security.admission.config.k8s.io/v1
      kind: PodSecurityConfiguration
      defaults: {enforce: baseline, enforce-version: latest, warn: baseline, warn-version: latest}
      exemptions: {namespaces: [kube-system]}
YAML
# No ingress controller or load balancer to hand out, and no helm-controller:
# it installs charts as cluster-admin for anyone who can write a HelmChart.
# The reserves keep the host and the front door alive when visitors fill it.
sudo tee /etc/rancher/k3s/config.yaml >/dev/null <<'YAML'
write-kubeconfig-mode: "0600"
disable: [traefik, servicelb]
disable-helm-controller: true
kube-apiserver-arg:
  - admission-control-config-file=/etc/rancher/k3s/psa.yaml
kubelet-arg:
  - max-pods=60
  - pod-max-pids=1024
  - system-reserved=cpu=500m,memory=1536Mi
YAML
if command -v k3s >/dev/null; then
  sudo systemctl restart k3s
else
  curl -sfL https://get.k3s.io | sudo sh -
fi
K="sudo k3s kubectl"
until $K get nodes >/dev/null 2>&1; do sleep 2; done
for d in coredns metrics-server local-path-provisioner; do
  until $K -n kube-system rollout status deploy/$d --timeout=10s >/dev/null 2>&1; do sleep 3; done
done

echo "== the visitor's account"
curl -fsSL "https://raw.githubusercontent.com/pulk17/k8n/$VERSION/deploy/oracle/visitor.yaml" | $K apply -f -
until token=$($K -n k8n-demo get secret visitor-token -o jsonpath='{.data.token}' | base64 -d) && [ -n "$token" ]; do sleep 1; done
ca=$(sudo grep certificate-authority-data /etc/rancher/k3s/k3s.yaml | awk '{print $2}')
sudo tee "$STATE/visitor.kubeconfig" >/dev/null <<KC
apiVersion: v1
kind: Config
clusters: [{name: demo, cluster: {server: "https://127.0.0.1:6443", certificate-authority-data: "$ca"}}]
users: [{name: visitor, user: {token: "$token"}}]
contexts: [{name: demo, context: {cluster: demo, user: visitor}}]
current-context: demo
KC

echo "== checking the sandbox"
V="sudo k3s kubectl --kubeconfig $STATE/visitor.kubeconfig"
check() { if eval "$2" >/dev/null 2>&1; then got=allowed; else got=refused; fi
  [ "$got" = "$1" ] && echo "   ok      $3" || { echo "   WRONG   $3 (was $got)"; failed=1; }; }
failed=0
$V create ns demo-check >/dev/null
check allowed "$V -n demo-check create configmap c" "a visitor can build in their own namespace"
check refused "$V -n kube-system create configmap c" "the system namespaces are read-only"
check refused "$V -n demo-check run p --image=busybox --overrides='{\"spec\":{\"containers\":[{\"name\":\"p\",\"image\":\"busybox\",\"securityContext\":{\"privileged\":true}}]}}'" "privileged pods are refused"
check refused "$V create clusterrolebinding c --clusterrole=cluster-admin --serviceaccount=k8n-demo:visitor" "no way to cluster-admin"
$V -n demo-check run net --image=busybox:latest --restart=Never -- wget -q -T 5 -O /dev/null http://1.1.1.1 >/dev/null
$V -n demo-check wait --for=jsonpath='{.status.phase}'=Failed pod/net --timeout=90s >/dev/null 2>&1 &&
  echo "   ok      pods cannot reach the internet" || { echo "   WRONG   a pod reached the internet"; failed=1; }
$V delete ns demo-check --wait=true >/dev/null
[ "$failed" = 0 ] || { echo "The sandbox is not holding; stopping before anything is opened to the internet."; exit 1; }

echo "== images the templates use, so a visitor's first try is not a download"
for img in nginx:alpine nginx:latest nginx:1.27-alpine redis:7-alpine postgres:15-alpine postgres:16-alpine \
  busybox:latest hashicorp/http-echo:latest prom/prometheus:v2.45.0 grafana/grafana:10.0.0; do
  sudo k3s crictl pull "docker.io/$img" >/dev/null || echo "   could not pull $img, skipping"
done

echo "== k8n $VERSION"
tmp=$(mktemp -d)
base="https://github.com/pulk17/k8n/releases/download/$VERSION"
curl -fsSL -o "$tmp/SHA256SUMS.txt" "$base/SHA256SUMS.txt"
for bin in k8n k8n-demo; do
  curl -fsSL -o "$tmp/$bin-linux-$ARCH" "$base/$bin-linux-$ARCH"
  (cd "$tmp" && grep " $bin-linux-$ARCH\$" SHA256SUMS.txt | sha256sum -c -)
  sudo install -m 0755 "$tmp/$bin-linux-$ARCH" "/usr/local/bin/$bin"
done
rm -rf "$tmp"
sudo chown -R k8n:k8n "$STATE"
sudo chmod 600 "$STATE/visitor.kubeconfig"

echo "== Tailscale"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
sudo tailscale up # prints a login link the first time
host=$(sudo tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')

echo "== the front door"
# The earlier, invite-only setup ran k8n as its own service; the door runs it now.
sudo systemctl disable --now k8n 2>/dev/null || true
sudo -u k8n /usr/local/bin/k8n-demo -baseline
sudo tee /etc/systemd/system/k8n-demo.service >/dev/null <<UNIT
[Unit]
Description=k8n public demo
After=network-online.target k3s.service

[Service]
User=k8n
ExecStart=/usr/local/bin/k8n-demo -origin https://$host
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$STATE
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable k8n-demo
sudo systemctl restart k8n-demo
sudo tailscale serve reset
sudo tailscale funnel --bg 8081 # asks you to allow Funnel for your tailnet the first time

cat <<DONE

  The demo is open at:

    https://$host/demo/

  Watch it:      sudo journalctl -u k8n-demo -f
  Close it:      sudo tailscale funnel reset && sudo systemctl stop k8n-demo
  Change limits: edit ExecStart in /etc/systemd/system/k8n-demo.service
                 (-session 20m -idle 3m -claim 2m -max-queue 30), then
                 sudo systemctl daemon-reload && sudo systemctl restart k8n-demo
DONE
