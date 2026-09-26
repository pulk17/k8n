# A public k8n demo on Oracle Cloud's free tier

Anyone with the link can try k8n on a real cluster, one person at a time.
Everyone else waits in a queue, and each visitor gets a clean cluster and a
fresh k8n. When their session ends, everything they made is deleted.

```
visitor ── https ──> Tailscale Funnel ──> k8n-demo (queue, sessions) ──> k8n ──> k3s
                                           127.0.0.1:8081                 :8090   visitor account only
```

## What visitors are told before they join

The waiting page (`/demo/`) lists the rules, and a visitor must tick that they
understand everything is deleted:

- **One session at a time**, up to 20 minutes, with a countdown bar and an End button.
- **Closing the tab ends the session** after 3 minutes.
- **Keep the waiting page open.** A closed page loses its place after 3 minutes.
  The next person gets 2 minutes to press Start (the title flashes and a
  notification is sent), or the turn passes on. Wait estimates come from real
  session lengths. At most 30 people can wait.
- **Everything is deleted at the end:** their namespaces, what they added to
  `default`, and k8n's own data (saved workflows, history, any AI key).
- **What the machine can take**, read from the cluster (cores, memory, pods),
  and what fits and what does not.
- **What is switched off:** internet from pods, "Open in browser", privileged
  pods, cluster-wide installs, and Ingress serving.

## What keeps a visitor from harming the machine or the next person

| Layer | What it does |
|---|---|
| RBAC (`visitor.yaml`) | Anything inside namespaces; create and delete namespaces; read the rest. No CRDs, ClusterRoles, webhooks, impersonation or token minting. |
| Admission policy (`visitor.yaml`) | System namespaces and the `default` namespace object are read-only; pod-security labels cannot be changed; no exec into system pods. |
| k3s pod security | `baseline` everywhere but kube-system: no privileged pods, host paths, host network or host ports. |
| k3s | No Traefik, ServiceLB or helm-controller. 60 pods, 1024 processes per pod, 0.5 CPU and 1.5 GB kept for the host. |
| iptables | Pods cannot reach the internet or Oracle's metadata service; k8n cannot reach the metadata service. |
| k8n-demo | The only thing reachable from outside. It forwards to k8n only with the current session's cookie (`SameSite=Lax`). k8n listens on localhost with a clean home and no API keys each session. |

`setup.sh` tests the sandbox before opening anything, and stops if a check fails.

Known limits: the queue lives in memory (a restart empties it and resets the
cluster); a visitor can read Secrets cluster-wide; a script can hold up to
`-max-queue` places.

## 1. Create the VM

Oracle console, **Compute → Instances → Create instance**:

- **Image:** Canonical Ubuntu 24.04 (not Minimal).
- **Shape:** Ampere `VM.Standard.A1.Flex`, 2 OCPUs and 12 GB (up to 4 and 24 are free).
- **Networking:** defaults, with a public IPv4 address. No ingress rules.
- **SSH keys:** paste your public key.
- **Advanced options → Management:** instance metadata service **version 2 only**.

If it says "Out of host capacity", try another availability domain or later.

## 2. Run the setup

You need a free [Tailscale](https://tailscale.com) account.

```bash
ssh ubuntu@<the VM's public IP>
curl -fsSLO https://raw.githubusercontent.com/pulk17/k8n/main/deploy/oracle/setup.sh
bash setup.sh
```

It prints a Tailscale login link, asks once to allow Funnel, checks the
sandbox, and prints the public address.

## 3. Run it

```bash
sudo journalctl -u k8n-demo -f                                   # joins, starts, ends, resets
sudo tailscale funnel reset && sudo systemctl stop k8n-demo      # close it
sudo systemctl start k8n-demo && sudo tailscale funnel --bg 8081 # open it again
```

Limits live in `ExecStart` of `/etc/systemd/system/k8n-demo.service`:
`-session 20m -idle 3m -claim 2m -stale 3m -max-queue 30`.
