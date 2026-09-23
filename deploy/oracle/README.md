# A private k8n demo on Oracle Cloud's free tier

A throwaway cluster with k8n on it, reachable only by the people you share the
machine with. Nothing listens on the internet: k8n binds to localhost and
Tailscale is the only way in.

## 1. Create the VM (once)

In the Oracle Cloud console: **Compute → Instances → Create instance**.

- **Image:** Canonical Ubuntu 24.04 (the aarch64 build).
- **Shape:** Ampere, `VM.Standard.A1.Flex` — 2 OCPUs and 12 GB is plenty, and
  within the Always Free allowance.
- **Networking:** the defaults. Do not add ingress rules; only SSH needs to be
  open, and Tailscale connects outwards.
- **SSH keys:** add your public key.

Free Ampere capacity runs out in some regions; if creating fails with "out of
capacity", try another availability domain or try again later.

## 2. Run the setup

```bash
ssh ubuntu@<the VM's public IP>
curl -fsSLO https://raw.githubusercontent.com/pulk17/k8n/main/deploy/oracle/setup.sh
bash setup.sh
```

It installs k3s, the k8n release binary (checked against the release's
SHA256SUMS), and Tailscale. The first `tailscale up` prints a link: open it and
log in with your Tailscale account. If `tailscale serve` asks to enable HTTPS
for your tailnet, allow it.

At the end it prints the pairing link, on the machine's Tailscale name.

## 3. Let someone in

Tailscale admin console → **Machines** → this VM → **Share**. They get this one
machine, not your tailnet. Send them the link.

## Know what you are handing over

Whoever has the link can do anything to that cluster — and a privileged pod is
root on the VM. That is fine for a throwaway demo box; it is why nothing else
should live on it.

```bash
sudo systemctl stop k8n && sudo tailscale serve reset   # close it
sudo journalctl -u k8n -f                                # watch it
```
