# Security

k8n talks to a Kubernetes cluster with whatever permissions your kubeconfig
has. Read this before you put it anywhere but your own machine.

## What k8n is

A local tool. It runs on your computer, reads `~/.kube/config`, and gives a
browser a way to drive that cluster. The safe deployment is the one where the
process and the cluster credentials sit on the same machine as the person using
them.

## The trust model

- **Pairing, not accounts.** A token pairs one browser with one running k8n.
  There are no users, no roles, and no audit trail: everyone who pairs has
  exactly the permissions of the kubeconfig k8n loaded.
- **The token is generated on first start**, saved in `~/.kube`'s neighbour
  `~/.k8n/token` (owner-readable), and printed as a link. Anyone holding it can
  change your cluster — treat it like a password.
- **Every `/api/*` and `/mcp*` route requires it.** The UI and `/health` do
  not: the page has to load in order to ask for a token, and container
  healthchecks have no way to know one.
- **The API listens on loopback by default** (`API_HOST`). The container image
  binds `0.0.0.0` on purpose, because there the isolation is the compose
  network.

## What the token protects against

Before it existed, any website you had open could make requests to k8n on
`127.0.0.1`. CORS stopped the page *reading* most replies, but not sending
requests, and a DNS-rebinding attack sidesteps CORS entirely by making the
attacker's page look same-origin.

The token closes both: it lives in k8n's own origin storage, so another site
cannot read it, and without it every API request is refused.

It does **not** protect against anything that can read your filesystem or your
browser storage, and it is not a substitute for real authentication on a shared
address.

## Do not do this

- **Do not expose k8n to the internet.** A single token, no rate limiting, no
  accounts, and full cluster access is not a combination that survives contact
  with a public address. If you need remote access, put it behind something
  that authenticates — Tailscale, Cloudflare Access, an authenticating proxy —
  and keep pairing on as well.
- **Do not set `K8N_NO_AUTH=true` on a laptop.** It turns pairing off. It exists
  for a trusted network behind an authenticating proxy, and nowhere else.
- **Do not run k8n against a production cluster with admin credentials** while
  you are learning it. Use a context scoped by RBAC to what you are willing to
  lose.

## MCP

k8n can act as an MCP server, so AI clients can drive it.

- `K8N_MCP_READONLY=true` limits those tools to reading (no apply, no delete).
  The Docker compose file defaults it to true.
- The HTTP MCP endpoint requires the pairing token like everything else.
- The stdio server (`cmd/k8n-mcp`) is spawned by the client as a local process
  and uses your kubeconfig directly — whoever can spawn it has your cluster.

## AI

- The assistant is off unless a key is configured. With no key, no request
  leaves your machine.
- When you ask it something, your canvas, the resource statuses on it, and
  anything its tools read from the cluster (logs, events, resource specs) are
  sent to the model provider. Do not point it at a cluster whose logs you
  cannot share.
- It proposes changes; it never applies them. A proposal has to compile before
  you see it, and applying still goes through the normal preview and dry run.
- Cluster output is passed to the model as untrusted data, and the prompts say
  so. That is a mitigation, not a guarantee: an LLM has no hard boundary
  between instructions and data, which is exactly why the assistant's tools are
  read-only and why nothing it proposes reaches the cluster on its own.

## Reporting a vulnerability

Open a GitHub security advisory on the repository, or an issue if it is not
sensitive. This is a personal project with no security team and no SLA — please
say so plainly in the report if you think something needs urgent attention.

## Known gaps

Stated plainly, because you should know them before trusting this:

- No authentication beyond the single pairing token, and no per-user anything.
- No rate limiting on any route.
- No audit log of what was applied or deleted, beyond the request log.
- Tested against Docker Desktop and kind. Cloud clusters (EKS/GKE/AKS), their
  auth plugins, admission webhooks and RBAC edge cases are not covered by any
  test.
- The AI path has had very little real-world use; treat its output as a
  suggestion from a stranger, which is what it is.
