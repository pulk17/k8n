# k8n API

The Go backend listens on `http://localhost:8080` by default (`API_PORT`).

In the normal setup you do not call it directly: the browser talks to the
Next.js origin and `next.config.ts` proxies `/api/*` and `/mcp/*` through, so
everything is same-origin and CORS never applies. Set `NEXT_PUBLIC_API_URL` only
when the API lives on a different host.

There is no authentication. k8n acts with whatever permissions your kubeconfig
has, so do not expose it beyond your machine without putting something in front
of it.

## Conventions

Errors are JSON and always carry `error`; most add `details` and a `hint`:

```json
{
  "error": "No cluster connection",
  "hint": "Pick a context on the Connect page, or check your kubeconfig"
}
```

| Status | Meaning |
| --- | --- |
| 400 | The request body or the graph is malformed |
| 403 | Refused: the resource is cluster machinery (see Protection) |
| 404 | No such resource |
| 503 | A dependency is missing — no cluster, no database, or no `GEMINI_API_KEY` |

`503` is not a crash. Every dependency k8n can work without returns it with a
hint, and the UI degrades instead of erroring.

---

## Health

### `GET /health`

```json
{
  "status": "ok",
  "database": "connected",
  "kubernetes": "connected",
  "k8sVersion": "v1.31.0",
  "context": "kind-k8n"
}
```

`database` and `kubernetes` are `"connected"` or `"disconnected"`. The endpoint
always answers 200 — it is what the frontend polls to decide whether to show its
"backend is down" screen.

---

## Cluster

### `GET /api/cluster/contexts`

The context names in your kubeconfig, as a JSON array of strings.

### `POST /api/cluster/connect`

```json
{ "context": "kind-k8n" }
```

Switches the active cluster for every subsequent request.

### `GET /api/cluster/namespaces`

Every namespace in the cluster, as a JSON array of strings. This comes from the
API rather than being derived from the resources that happened to come back, so
empty namespaces still appear.

### `GET /api/cluster/resources?namespace=<ns>`

A flat list of the resources k8n models. Omit `namespace` for all of them.

Each entry carries identity, status, and — importantly — the **references** it
holds, which is what the canvas draws edges from:

```json
{
  "kind": "Deployment",
  "name": "web-app",
  "namespace": "default",
  "uid": "…",
  "status": "Running",
  "protected": false,
  "replicas": 3,
  "readyReplicas": 3,
  "image": "nginx:1.27-alpine",
  "containers": [{ "name": "web-app", "image": "nginx:1.27-alpine" }],
  "configMapRefs": ["app-config"],
  "secretRefs": ["app-secrets"],
  "pvcRefs": ["app-data"],
  "serviceAccountName": "app-sa"
}
```

Kind-specific fields are present only where they apply: `selector`, `ports`,
`clusterIP` and `externalIP` on Services; `backends` and `hosts` on Ingresses;
`scaleTargetKind`/`scaleTargetName` on HPAs; `storageSize` on PVCs; `podIP`,
`nodeName` and `restartCount` on Pods.

Results are sorted by kind, namespace and name so the list does not reshuffle
between refreshes.

### `GET /api/cluster/crds`

The CustomResourceDefinitions installed in the cluster, so the toolbox can offer
them. They compile through the node's raw `spec` field.

### `GET /api/schema/:kind`

The OpenAPI schema the cluster publishes for a kind.

### `DELETE /api/resource/delete?force=true`

```json
{ "kind": "Deployment", "name": "web-app", "namespace": "default" }
```

`force` drops the grace period and cascades in the background — for objects
stuck terminating. It is **not** a way past the protection check.

Resolution goes through discovery, so this works for any kind the cluster knows,
including CRDs.

#### Protection

Deletes are refused with `403` for anything in `kube-system`, `kube-public`,
`kube-node-lease` or `local-path-storage`, and for names containing
`kube-apiserver`, `kube-scheduler`, `kube-controller-manager`, `kube-proxy`,
`coredns`, `etcd`, `metrics-server`, `local-path-provisioner`, `kubernetes` or
`kube-root-ca.crt`.

This is enforced in the API, not only in the UI, so the MCP tools and the
assistant are bound by it too. Use `kubectl` if you genuinely need to remove
cluster components.

---

## Graph

The canvas is the source of truth. It is compiled **as a whole**, which is what
lets edges resolve into real references — a Service's selector comes from the
workload it points at, not from its own name.

### `POST /api/graph/compile`

```json
{
  "nodes": [{ "id": "dep", "data": { "kind": "Deployment", "name": "web", "replicas": 3 } }],
  "edges": [{ "id": "e1", "source": "svc", "target": "dep" }]
}
```

Response:

```json
{
  "yaml": "apiVersion: apps/v1\nkind: Deployment\n…",
  "objects": 6,
  "notes": [
    {
      "nodeId": "dep-1",
      "kind": "Deployment",
      "name": "web-app",
      "level": "info",
      "message": "Imported resource — applying a partial patch so untracked fields are preserved."
    }
  ]
}
```

`notes` is how the compiler explains what it decided. `level` is `info` or
`warning`; a warning means something on the canvas did not make it into the
manifest, and the reason is in `message`. Nothing is dropped silently.

**What edges compile to:**

| Edge | Result |
| --- | --- |
| Service → workload | `spec.selector` and `targetPort` from the workload |
| Ingress → Service | the backend service name and port |
| HPA → workload | `scaleTargetRef` |
| ConfigMap/Secret → workload | an `envFrom` source |
| PVC → workload | a volume plus a `volumeMount` |
| ServiceAccount → workload | `spec.serviceAccountName` |
| NetworkPolicy → workload | `podSelector` |
| Role → RoleBinding | `roleRef` |
| ServiceAccount → RoleBinding | a subject |

Nodes imported from the cluster compile differently: k8n only ever saw a summary
of them, so it emits a **partial** object containing just the fields you edited
and lets server-side apply merge it. Regenerating them in full would strip
probes, limits, volumes and everything else k8n does not model.

### `POST /api/graph/import`

```json
{ "yaml": "apiVersion: apps/v1\nkind: Deployment\n…" }
```

The inverse of compile: parses manifests into canvas nodes, with edges taken
from the manifest's own references — selectors matched against pod labels,
ingress backends, scale targets, `envFrom`, volumes and service accounts.

```json
{
  "nodes": [
    {
      "id": "Deployment/default/web-app",
      "kind": "Deployment",
      "name": "web-app",
      "namespace": "default",
      "fields": { "replicas": 3, "image": "nginx:1.27-alpine", "containerPort": 8080 }
    }
  ],
  "edges": [{ "source": "Service/default/web-svc", "target": "Deployment/default/web-app" }],
  "notes": []
}
```

`fields` uses the same names the compiler reads, so import → compile round-trips
back to the manifest you started from.

### `POST /api/graph/apply?dryRun=true`

```json
{ "yaml": "…" }
```

Server-side apply with field manager `k8n`. Namespaces the manifest targets are
created first. `dryRun=true` sends `dryRun=All`, so the API server validates
everything and writes nothing — the UI always does this before a real apply.

Per-resource failures come back as `400` with an `errors` array rather than
failing the whole batch:

```json
{ "success": false, "errors": [{ "resource": "web-app", "message": "…" }] }
```

---

## Saved workflows

These need Postgres (`DATABASE_URL`). Without it they return `503` and the
frontend falls back to browser storage.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/graph/save` | Create or update. Body: `{id?, name, namespace, graph_json}` |
| `GET` | `/api/graph/list` | Summaries, newest first |
| `GET` | `/api/graph/:id` | One workflow, including `graph_json` |
| `DELETE` | `/api/graph/:id` | Remove it |

---

## Logs, events and diagnosis

### `GET /api/logs/:namespace/:pod`

Query: `container`, `tailLines` (default 200), `previous`.

`previous=true` reads the last terminated container, which is where a
CrashLoopBackOff actually explains itself.

### `GET /api/events/:namespace`

Query: `object` to filter to one resource's events, `limit` (default 50).
Newest first.

### `GET /api/diagnose/:namespace`

Deterministic checks, run without any model involved:

- CrashLoopBackOff, ImagePullBackOff / ErrImagePull, CreateContainerConfigError
- containers killed for running out of memory
- pods that cannot be scheduled
- Deployments that never reached their replica count
- PersistentVolumeClaims stuck unbound
- **Services whose selector matches no pods** — the silent failure that looks
  like a working deployment until nothing can reach it

```json
{
  "namespace": "default",
  "checked": 14,
  "findings": [
    {
      "severity": "warning",
      "kind": "Service",
      "name": "web-svc",
      "reason": "NoEndpoints",
      "detail": "Selector map[app:web-svc] matches no pods, so this Service routes nowhere.",
      "hint": "The selector must equal the labels on the workload's pod template."
    }
  ],
  "events": []
}
```

`severity` is `critical`, `warning` or `info`.

---

## Metrics

All of these need metrics-server in the cluster.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/metrics/check` | Whether metrics-server is reachable |
| `GET` | `/api/metrics/namespace?namespace=<ns>` | Every pod in a namespace |
| `GET` | `/api/metrics/pod/:name?namespace=<ns>` | One pod, per container |
| `GET` | `/api/metrics/:namespace/:kind/:name` | Aggregated over a workload's pods |

The aggregate reports CPU in **millicores**, not a percentage:

```json
{ "cpu": 47.5, "cpuUnit": "m", "memory": 128.4, "memoryUnit": "Mi", "pods": 3 }
```

---

## Helm

Every Helm route runs against **the cluster k8n is connected to**. This used to
be built from the ambient kubeconfig's current-context, so picking a context on
the Connect page changed where manifests were applied but not where charts were
installed — you could install into a cluster you were not looking at.

Charts are located by repository URL, the way `helm install --repo` does.
Nothing is written to your `repositories.yaml`; the previous version appended
four repositories to it on every install.

### `GET /api/helm/search?q=<query>`

Artifact Hub results, each carrying its repository name **and URL** so the chart
can be installed straight from it.

### `POST /api/helm/template`

```json
{
  "releaseName": "cache",
  "chart": "redis",
  "repoUrl": "https://charts.bitnami.com/bitnami",
  "version": "20.1.0",
  "namespace": "demo",
  "valuesYaml": "architecture: standalone"
}
```

Renders the chart to YAML without installing anything, and works without a
cluster. This is what puts a Helm node in the manifest preview: a chart used to
be installed straight from the canvas with no dry run and no way to see what it
would create.

### `POST /api/helm/install`

Same body. Creates the release, creating the namespace if needed.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/helm/releases` | Installed releases |
| `GET` | `/api/helm/releases/:name` | One release, with its rendered manifest |
| `GET` | `/api/helm/releases/:name/history` | Its revisions, newest first |
| `POST` | `/api/helm/releases/:name/upgrade` | New values or a new version |
| `POST` | `/api/helm/releases/:name/rollback` | Body: `{namespace, revision}` |
| `DELETE` | `/api/helm/releases/:name` | Uninstall |

`version` is honoured everywhere it appears. The old install endpoint accepted a
`chartVersion` and silently discarded it.

---

## AI assistant

Every route here returns `503` with a hint when `GEMINI_API_KEY` is unset, and
the frontend hides the panel based on `/api/ai/status`.

### A supervisor and two specialists

One model holding every tool answered "why is this pod failing" by proposing a
graph change, and "add a cache" by dumping logs. The assistant is now a
supervisor that delegates:

| Agent | Brief | Tools |
| --- | --- | --- |
| `inspector` | Read the cluster and report findings. Cannot change anything. | `diagnose`, `list_resources`, `get_logs`, `get_events`, `list_helm_releases`, plus any external MCP tools |
| `architect` | Design a change to the canvas and propose it. | `propose_graph_patch` only |

The supervisor sees each specialist as a single tool (`ask_inspector`,
`ask_architect`), decides who to consult, and writes the reply. Nested tool
calls are streamed with the specialist's name attached, so the trace shows who
did what.

**Proposals are verified before you see them.** `propose_graph_patch` applies
the patch to a copy of the graph and compiles it. A patch that does not build is
returned to the architect as an error to fix rather than being shown as a
suggestion that fails on apply; compiler warnings are passed back too. This gate
is deterministic — no second model reviewing the first.

### `GET /api/ai/status`

```json
{
  "enabled": true,
  "model": "gemini-2.5-flash",
  "agents": ["inspector", "architect"],
  "mcpServers": [{ "name": "docs", "tools": 4 }]
}
```

### `POST /api/ai/chat`

Streams the turn as Server-Sent Events. Each `data:` line is one event:

| `type` | Payload |
| --- | --- |
| `text` | A chunk of the reply |
| `tool` | The tool called, as `agent.tool` when a specialist made the call |
| `patch` | A verified proposal for the canvas |
| `error` | Something went wrong |
| `done` | End of turn |

The assistant edits **the graph**, never YAML, and a `patch` is only a proposal
— it reaches the canvas when you accept it, as a single undoable step. It cannot
apply anything to the cluster.

Cluster data is treated as untrusted input: names, labels and log lines are
data, not instructions.

### `POST /api/ai/explain`

A one-shot explanation of a resource, without the chat loop.

---

## MCP

The same capabilities as an MCP server, so any MCP client can drive k8n.

Two transports, one implementation:

- **stdio** — `apps/api/cmd/k8n-mcp`, which clients spawn. Diagnostics go to
  stderr because stdout is the protocol.
- **streamable HTTP** — `/mcp` on the running API, for clients that connect to
  an already-running k8n.

```jsonc
{
  "mcpServers": {
    "k8n": { "command": "/path/to/k8n-mcp" }
  }
}
```

### Tools

| Tool | Read-only | What it does |
| --- | --- | --- |
| `list_contexts` | yes | Contexts in the kubeconfig |
| `use_context` | no | Switch the active cluster |
| `list_resources` | yes | Resources, with their references |
| `get_logs` | yes | Container logs |
| `get_events` | yes | Recent events |
| `diagnose` | yes | The deterministic checks above |
| `compile_graph` | yes | Compile nodes and edges to YAML |
| `apply_yaml` | no | Server-side apply — **dry run by default** |
| `delete_resource` | no | Delete one resource, protection enforced |

`apply_yaml` defaults `dryRun` to `true`: a client has to ask explicitly to
write to the cluster. Set `K8N_MCP_READONLY=true` to drop the three writing
tools entirely — worth doing for anything reachable beyond localhost, since
there is no authentication.

### k8n as an MCP client

The other direction: point k8n at MCP servers you already run and their tools
become available to the assistant alongside its own. Set `K8N_MCP_SERVERS` to a
path or to the JSON itself, in the shape every other MCP client uses:

```json
{
  "mcpServers": {
    "docs":    { "command": "npx", "args": ["-y", "@acme/docs-mcp"] },
    "grafana": { "url": "http://localhost:9000/mcp" }
  }
}
```

Both transports work: `command`/`args` spawns a stdio server, `url` connects to
one over streamable HTTP. `"disabled": true` keeps an entry without connecting
to it.

Remote tools are namespaced `server__tool`, so two servers can both offer a
`search`. They go to the inspector and the supervisor — the architect stays
focused on the canvas. A server that fails to start is logged and skipped;
nothing else stops working.
