# k8n — Engineering Spec

Status: living document. Written 2026-08-08 after a full read of the codebase
(`apps/api` ~3.0k LOC Go, `apps/web` ~6.4k LOC TypeScript).

This is not a wishlist. Sections 1–3 are defects that exist in `master` today,
each verified by reading the code path end to end. Sections 4–6 are the MCP and
agentic-AI layer. Section 7 is the delivery order.

---

## 0. Guiding rules

1. **The graph is the source of truth, and edges must mean something.** Today
   almost every edge is decorative — it renders, but no compiled YAML depends on
   it. That is the single largest thing wrong with the product.
2. **Every kind you can drag must be a kind you can apply.** No dead entries in
   the toolbox.
3. **Never silently discard user input.** If a field renders in a node, it must
   reach the cluster or refuse loudly.
4. **One API origin.** The browser talks to Next; Next proxies to Go. No CORS in
   the normal path.
5. **No test scaffolding, no ceremony.** Fix the product, don't decorate it.

---

## 1. Critical defects — graph semantics

### 1.1 Service selectors ignore edges → services route to nothing

`apps/api/internal/handlers/mapper.go:121-132` hardcodes:

```go
"selector": map[string]interface{}{ "app": name }
```

`name` is the **Service's own name**. A Service `nginx-service` wired to a
Deployment `nginx-deployment` compiles to `selector: {app: nginx-service}`,
while the Deployment's pods carry `app: nginx-deployment`. The selector matches
zero pods. Every Service the tool has ever produced is a black hole unless the
user happened to name both nodes identically.

**Fix:** resolve the selector from the outgoing edge to its workload target and
emit that workload's pod labels.

### 1.2 Ingress backends ignore edges

`mapper.go:257` sets `serviceName := name` — the Ingress's own name — and
`servicePort` from the Ingress node's own `port` field. An Ingress wired to a
Service never points at it. Same class of bug as 1.1.

**Fix:** resolve backend service name/port from the `Ingress → Service` edge.

### 1.3 HPA target resolution works, but the edge cannot be drawn

`apps/web/lib/compiler.ts:12-22` correctly reads the HPA's outgoing edge to fill
`scaleTargetRef`. But in `apps/web/components/K8sNode.tsx`, `Deployment` and
`StatefulSet` declare **only** `network` and `config` input handles
(`K8sNode.tsx:81-112`), while HPA emits a `scaling` output (`:253-262`). There is
no handle to drop onto, and `handleConnect` additionally rejects mismatched
handle types (`canvas/page.tsx:136-139`).

The HPA→workload edge is **physically undrawable**, so the resolution code at
`compiler.ts:12` is unreachable and every HPA compiles with
`scaleTargetRef.name = <the HPA's own name>`.

The same gap kills `PersistentVolumeClaim` (`storage`), `ServiceAccount` and
`NetworkPolicy` (`security`) — all declare outputs that accept Deployment, and
Deployment accepts none of them.

**Fix:** `nodeConnectionRules` inputs must be the exact dual of the declared
outputs. Derive both sides from one table instead of maintaining two by hand.

### 1.4 ConfigMap / Secret / PVC edges compile to nothing

`VALID_CONNECTIONS` (`lib/constants.ts:51-53`) permits ConfigMap→Deployment,
Secret→Deployment, PVC→Deployment. The mapper emits no `envFrom`, no `volumes`,
no `volumeMounts` for Deployment at all. Only StatefulSet has a partial
`envFromSecret` path (`mapper.go:209-213`), and it reads a *typed field on the
node*, not the edge.

So: you can wire a ConfigMap into a Deployment, see a satisfying yellow line,
apply, and the Deployment has no idea the ConfigMap exists.

**Fix:** edges of type `config` become `envFrom` entries; edges of type
`storage` become a `volume` + `volumeMount` pair.

### 1.5 Compilation is per-node and therefore cannot see the graph

`compiler.ts` loops nodes and issues one `POST /api/mapper/:kind` per node. The
backend receives a single node's data with no edges, no siblings, no namespace
context. Every relationship bug above is downstream of this architecture: the
component that knows the edges (frontend) delegates YAML generation to a
component that cannot see them (backend mapper).

It is also N HTTP round-trips for an N-node graph.

**Fix:** replace with a single `POST /api/graph/compile` taking
`{nodes, edges}`, returning the full multi-document YAML. `mapper.go` becomes an
internal function over a resolved graph, not a per-node HTTP handler. Keep
`/api/mapper/:kind` as a thin single-node wrapper for backwards compatibility.

### 1.6 Import-from-cluster → Apply silently destroys live resources

`canvasStore.hydrateGraph()` builds nodes from the cluster summary — which
carries only `kind`, `name`, `namespace`, `labels`, `status`, `replicas`,
`image`. Pressing **Apply to Cluster** feeds those nodes back through the mapper,
which reconstructs a Deployment from scratch: one container, default port,
no env, no volumes, no probes, no resource limits, no annotations.

Because apply uses server-side apply with `FieldManager: "k8n"`
(`apply.go:133-148`), the reconstructed spec **replaces** the real one. Import a
production Deployment, click Apply, and you have wiped its configuration down to
`nginx:latest` on port 80.

**Fix (must land before anything else ships):**
- Cluster-imported nodes are flagged `origin: "cluster"` and carry the full
  original object.
- Apply sends back the original object with only user-edited fields patched.
- Nodes the user has not edited are excluded from the apply set entirely.
- The apply confirmation shows a diff (§3.4) so this is never invisible again.

---

## 2. Critical defects — coverage and dead code

### 2.1 Eight of nineteen toolbox kinds cannot be applied

`ResourceToolbox.tsx:19-48` offers 19 kinds. `mapper.go`'s switch handles 11.
Dragging any of these and applying returns HTTP 400 `Unsupported resource kind`:

`Pod`, `NetworkPolicy`, `PersistentVolume`, `ServiceAccount`, `Role`,
`RoleBinding`, `ClusterRole`, `ClusterRoleBinding`

Plus **every CRD** the toolbox discovers and lists (`ResourceToolbox.tsx:88-110`)
— `crd.go` advertises them, the mapper rejects all of them.

**Fix:** implement the eight missing built-ins; add a generic CRD path that
takes the node's `spec` YAML textarea and emits
`{apiVersion, kind, metadata, spec}`.

### 2.2 Node fields that go nowhere

| Field | Rendered at | Fate |
|---|---|---|
| `secretData` | `K8sNode.tsx:673` | **Discarded.** `mapper.go:246` always emits `data: {}` |
| `tlsEnabled` | `K8sNode.tsx:626` | **Discarded.** No TLS block in the Ingress mapper |
| `spec` (CRD textarea) | `K8sNode.tsx:777` | **Discarded** for Job/CronJob/DaemonSet (explicit cases ignore it); 400 for real CRDs |
| `chartVersion` | `K8sNode.tsx:434` | **Discarded.** `canvas/page.tsx:244` never sends it to `/api/helm/install` |

Job, CronJob and DaemonSet have **no editors at all** — they fall through to the
generic CRD textarea, whose contents the mapper then ignores. Their images and
commands are hardcoded (`mapper.go:427`, `:458`: `echo Hello from Job`).

### 2.3 Resources the graph reasons about but never fetches

`edges.ts` has rules for `PersistentVolumeClaim` (rule 4) and
`HorizontalPodAutoscaler` (rule 5). `cluster.go` never lists either kind. Both
rules are dead code against an always-empty array.

`canvasStore.hydrateGraph()` also strips `Pod` and `ReplicaSet` before calling
`generateEdges` (`canvasStore.ts:175-196`), so rule 6 — the entire
Deployment→ReplicaSet→Pod ownership chain — is dead too. And because Pods never
reach the canvas, the pod-click metrics panel (`canvas/page.tsx:620-628`) can
never fire.

**Fix:** fetch PVCs, HPAs and ServiceAccounts in `cluster.go`; make the
Pod/ReplicaSet filter a user-facing toggle ("show pods") rather than a hardcoded
strip.

### 2.4 Edge inference is a namespace cross-product

Where real relationship data exists, `edges.ts` ignores it:

- **Ingress→Service** (`edges.ts:68-83`): connects *every* Ingress to *every*
  Service in the namespace. The actual backend is never consulted — `cluster.go`
  doesn't return Ingress rules.
- **PVC→workload** (`:114-129`): every PVC to every workload, including Pods.
- **HPA→workload** (`:132-147`): every HPA to every workload, ignoring
  `scaleTargetRef`.
- **ConfigMap→workload** (`:87-111`): fuzzy string matching on names
  (`config.name.includes(workloadBase)`), not `envFrom`/`volumes` references.

On a 40-service namespace this is quadratic and almost entirely wrong.

**Fix:** return real reference data from `cluster.go` (ingress rules, HPA
targetRef, pod volume claims, container `envFrom`/`volumeMounts`) and match on
it. Delete the fuzzy name heuristic.

### 2.5 Dead dependencies and dead endpoints

- `@monaco-editor/react`, `@rjsf/core`, `@rjsf/utils`, `@rjsf/validator-ajv8`,
  `clsx` — installed, **zero imports**. README advertises Monaco as part of the
  stack.
- `gorilla/websocket` — an `upgrader` is configured (`main.go:31-41`) with no WS
  route anywhere. README describes `main.go` as "HTTP server, routes, CORS,
  WebSocket".
- `GET /api/schema/:kind` — no frontend caller. Also broken: it title-cases a
  lowercased kind (`schema.go:25`), turning `ConfigMap` into `Configmap`, which
  matches no case in its own switch.
- `FetchDynamicResources` (`crd.go:74`) — never called.

**Fix:** Monaco earns its place as the YAML preview/diff editor (§3.4). RJSF and
`clsx` get removed. The websocket upgrader either becomes the live-status stream
(§3.5) or gets deleted — no orphan scaffolding.

### 2.6 Miscellaneous

- `metrics.go:222` shadows `err` inside the fallback branch; a failing final
  label selector makes the handler 404 even when the fallback found pods.
- `metrics.go:294` labels `millicores / 10` as a CPU percentage. That is only
  true if every pod has exactly a 1-core limit. Report millicores, or divide by
  the actual limit.
- `canvas/page.tsx:147-159` restyles "the last edge in the array" inside a
  `setTimeout(0)` after connecting. Racy and wrong under undo/redo. Pass the
  style through `onConnect` instead.
- `canvas/page.tsx:72-76` sets `hasUnsavedChanges` and nothing ever reads it —
  no beforeunload guard, no dirty indicator.
- `hydrateGraph` derives the namespace list from returned resources, so empty
  namespaces never appear in the dropdown, and a manually-built graph has an
  empty namespace selector.
- Apply operates on all `nodes`, ignoring the active namespace filter, so you can
  apply things you cannot see.

---

## 3. Frontend refinement

### 3.1 One API origin
`next.config.ts` already proxies `/api/*` to the Go backend, but `.env.example`
sets `NEXT_PUBLIC_API_URL=http://localhost:8080`, so the browser bypasses the
proxy and goes cross-origin — which is why `main.go` has grown an
`AllowOriginFunc` that allows *anything containing the substring "ngrok"*
(`main.go:73`).

Default `NEXT_PUBLIC_API_URL` to empty, route everything through the Next
rewrite, and reduce the CORS config to an explicit env-driven allowlist.

### 3.2 Node editors
Drive the expanded node body from a per-kind field schema instead of the current
chain of `data.kind === '...'` blocks. Each entry declares fields, types,
defaults and help text; the component renders it. Adding a kind becomes a table
entry rather than another branch in an 840-line component.

Every kind in the toolbox gets a real editor — including Job, CronJob, DaemonSet,
NetworkPolicy, ServiceAccount and RBAC kinds.

### 3.3 Connection model
One table defines, per kind: outputs (type + accepted kinds) and inputs (type +
source kinds). Handles, `VALID_CONNECTIONS`, edge colouring and compile-time
resolution all read from it. This is what makes §1.3 impossible to reintroduce.

### 3.4 YAML preview & diff before apply
A side panel showing the compiled multi-document YAML in Monaco, and — for
resources that already exist in the cluster — a diff against live state. Apply
becomes: preview → dry-run → diff → confirm → apply. This is the direct
mitigation for §1.6.

### 3.5 Live status
Replace refresh-button polling with a `/api/cluster/watch` SSE stream; node
status dots update in place. (This is what the orphan websocket upgrader was
reaching for; SSE is the simpler fit for one-way status.)

**Done**, though not with the client-go informers first sketched here. The
stream polls `CollectResources` on the server every 3s and sends only what
changed, keyed by UID. Informers would push faster and cost the API server
less, but they would need a shared factory torn down and rebuilt whenever the
Connect page swaps the cluster, plus a second path from live object to
`Resource` alongside the one `CollectResources` already has. Polling reuses
that path exactly, so the list and the stream cannot disagree. Worth revisiting
if k8n is ever pointed at a cluster big enough for the LIST calls to hurt.

### 3.6 General
- Unified toast system; `alert()`/`confirm()` in `deployed/page.tsx` replaced
  with real modals — particularly "Delete All", which currently fires N deletes
  behind a browser confirm.
- `beforeunload` guard wired to the existing `hasUnsavedChanges` state.
- Namespace list from a real `/api/cluster/namespaces` endpoint.
- Empty/loading/error states that distinguish "no cluster connected" from
  "cluster connected, nothing here".

---

## 4. MCP server

k8n exposes its capabilities over the Model Context Protocol so Claude Code,
Claude Desktop and other MCP clients can drive a cluster through the same
validated paths the UI uses.

**Dependency:** `github.com/modelcontextprotocol/go-sdk` (v1.7.0, verified
available).

**Transports:**
- `stdio` — `apps/api/cmd/k8n-mcp`, the binary users register with an MCP client.
- Streamable HTTP at `/mcp` on the main API, for remote/in-app use.

Both bind the same tool implementations, which are the same internal functions
the REST handlers call. No duplicated logic.

### Tools

| Tool | Kind | Description |
|---|---|---|
| `list_contexts` | read | kubeconfig contexts |
| `use_context` | write | switch active context |
| `list_resources` | read | cluster resources, filterable by namespace/kind |
| `describe_resource` | read | full object for one resource |
| `get_logs` | read | pod logs, with `container`, `tailLines`, `previous` |
| `get_events` | read | events for a resource or namespace |
| `get_metrics` | read | CPU/memory via metrics-server |
| `compile_graph` | pure | `{nodes, edges}` → YAML |
| `apply_yaml` | **write** | server-side apply; `dryRun` defaults **true** |
| `delete_resource` | **write** | delete by kind/name/namespace |
| `list_graphs` / `load_graph` / `save_graph` | read/write | saved workflows |
| `helm_search` / `helm_list` / `helm_install` / `helm_upgrade` / `helm_rollback` / `helm_uninstall` | mixed | Helm lifecycle |
| `diagnose` | read | §5.2 triage bundle for a namespace or workload |

`get_logs` and `get_events` do not exist in the REST API yet and must be built —
they are the two things any diagnostic agent needs first.

### Safety
- Every mutating tool is annotated destructive/non-idempotent per MCP tool
  annotations, so clients can gate them.
- `apply_yaml` defaults to `dryRun: true`; a real apply requires an explicit
  `dryRun: false`.
- `K8N_MCP_READONLY=true` unregisters all write tools at startup — the default
  for anything exposed beyond localhost.
- Protected-namespace rules from `deployed/page.tsx` move server-side so both the
  UI and MCP honour them.

---

## 5. In-app agent (Gemini)

**Dependency:** `google.golang.org/genai` (v1.67.0, verified available).
Key from `GEMINI_API_KEY`; model from `GEMINI_MODEL`, default
`gemini-2.5-flash`. When the key is absent every AI surface is hidden and the
rest of k8n works exactly as before — the AI layer is strictly additive.

### 5.1 Graph copilot
A canvas side panel. Natural language in, graph mutations out.

The agent is given the same tool set as §4 plus graph-mutation tools
(`add_node`, `connect`, `set_field`, `remove_node`). It does not write YAML
directly — it manipulates the graph, and the existing compiler produces the YAML.
That keeps one code path to trust and makes every AI action visible on the canvas
and undoable with `Ctrl+Z`.

Proposed changes render as ghosted nodes/edges with **Accept** / **Reject**.
Nothing touches the cluster without an explicit apply.

`POST /api/ai/chat` streams via SSE: text deltas, tool calls, and a final graph
patch.

### 5.2 Diagnose
Given a failing workload, the agent gathers pod status, recent events, logs
(including `previous` for crash loops), and the owning spec, then explains the
failure and proposes a concrete fix as a graph patch.

Deterministic pre-checks run first and are passed to the model as structured
findings rather than left for it to infer: `CrashLoopBackOff`, `ImagePullBackOff`
/ `ErrImagePull`, `OOMKilled`, pending-unschedulable, readiness-probe failures,
`CreateContainerConfigError` from a missing ConfigMap/Secret, and — using §1.1's
machinery — **Services whose selector matches zero pods**.

### 5.3 Explain
Select any node → plain-English explanation of what it does, what it is wired to,
and what looks wrong. Cheap, obvious, high value for the ComfyUI-for-k8s pitch.

### 5.4 Guardrails
- The agent never applies. It proposes; a human applies.
- Tool results injected into the prompt are cluster data, treated as data — a
  ConfigMap containing "ignore previous instructions" must not steer the agent.
- Secret **values** are never sent to the model; only key names.
- Token budget per request; truncate logs to a bounded tail.

---

## 6. Deployment & docs

- `README.md` currently documents Monaco and WebSocket, neither of which is
  wired, and a `docs/API.md` that predates the current routes. Both need to
  match reality after §2.5 and §4.
- `.env.example` gains `GEMINI_API_KEY`, `GEMINI_MODEL`, `K8N_MCP_READONLY`, and
  loses the `NEXT_PUBLIC_API_URL` default (§3.1).
- `deploy/aws/main.tf` and `docker-compose.prod.yml` pass the new env through.
- `apps/api/Dockerfile` builds the `k8n-mcp` binary alongside the API.

---

## 7. Delivery order

Ordered by "what makes the product not lie to its user", not by difficulty.

**P0 — the graph must mean something**
1. `POST /api/graph/compile` over `{nodes, edges}`; mapper becomes internal (§1.5)
2. Edge-resolved Service selectors and Ingress backends (§1.1, §1.2)
3. Unified connection table; every declared output has a matching input (§1.3, §3.3)
4. `config` and `storage` edges compile to `envFrom` / volumes (§1.4)
5. Import-then-apply no longer destroys live resources (§1.6)

**P1 — no dead ends**
6. All 19 toolbox kinds compile; generic CRD path (§2.1)
7. `secretData`, `tlsEnabled`, `chartVersion`, CRD `spec` reach the cluster (§2.2)
8. Fetch PVC/HPA/ServiceAccount; real reference-based edge inference (§2.3, §2.4)
9. Schema-driven node editors for every kind (§3.2)
10. Single API origin; tightened CORS (§3.1)

**P2 — the polish that makes it feel finished**
11. YAML preview + diff + apply flow (§3.4)
12. `get_logs` / `get_events` endpoints (needed by §4 and §5.2)
13. SSE live status (§3.5)
14. Toasts, modals, dirty guard, namespace endpoint (§3.6)
15. Remove dead deps; fix metrics bugs; docs match reality (§2.5, §2.6, §6)

**P3 — the differentiator**
16. MCP server, stdio + HTTP, read tools (§4)
17. MCP write tools with annotations and readonly mode (§4)
18. Gemini client, `/api/ai/chat` SSE, explain (§5.3)
19. Graph copilot with propose/accept (§5.1)
20. Diagnose with deterministic pre-checks (§5.2)

---

## 8. What shipped

Everything in P0, P1 and P3 is done, and all of P2 except live status.

Beyond the list above:

- **`POST /api/graph/import`** — manifests are parsed by the backend, with edges
  read from the manifest's own references. The frontend used to do this with
  regexes over the raw text: it took the first `name:` in each document (often a
  container's), ignored every field it had no pattern for, and connected each
  Service to whichever Deployment shared its namespace. Import → compile now
  round-trips: 8/8 documents byte-identical on a graph covering every edge type.
- **Delete works for every kind.** It was a hardcoded switch over eleven kinds,
  so PVCs, HPAs, RBAC and every CRD could be created and never cleaned up.
  Resolution now goes through discovery.
- **Protection is enforced server-side** (`403`), not just hidden in the UI, so
  the MCP tools and the assistant are bound by it too.
- **One saved-workflow list.** localStorage and Postgres were two parallel
  systems shown as two lists; `lib/workflows.ts` uses the database when it is
  there and the browser when it is not, and the UI says which.
- **`alert()` / `confirm()` are gone** — 32 call sites replaced by `notify()` and
  `confirmAction()` against one mounted `<Dialogs />`.
- **`main.go` is wiring only.** Handlers moved to `handlers/system.go`.
- `/api/mapper/:kind`, `/api/graph/dry-run`, `/k8s/check` and `/helm/check` are
  removed; nothing called them and the first is what caused §1.

### Not done

- **Live-cluster verification.** There is no container runtime on this machine,
  so the write paths — apply, delete, logs, diagnose, metrics — are verified by
  construction and against the API's own types, not against a running cluster.
  The read path behind `/api/cluster/watch` has been driven end to end against
  a stub API server, which is not the same as a real one. Bring up kind or
  minikube to exercise the rest.

### How it was verified

- `go build`, `go vet`, `gofmt` clean; `tsc --noEmit`, `eslint` and
  `next build` clean (eslint was 69 errors before this work).
- All four templates compile: 33 objects, 0 failures, every document strict-
  decoded against the real Kubernetes scheme.
- A 16-resource graph covering every supported kind compiles and validates; the
  importer recovers all 9 edges from the resulting manifest.
- The whole flow driven through the real UI in a headless browser — templates,
  compile, import, recompile, save without a database, deployed page without a
  cluster — with no console errors.
- MCP over stdio: 9 tools with correct annotations, `apply_yaml` dry-run by
  default, `K8N_MCP_READONLY=true` drops the three writing tools, and a graceful
  refusal when no cluster is connected.

---

## 9. Canvas: colour and connections

Two independent palettes, because they answer different questions:

- `RESOURCE_COLORS` — what a node **is**. One hue family per category:
  workloads blue, batch teal, networking green/pink, configuration amber,
  storage purple, access control slate, scaling cyan.
- `CONNECTION_TYPES` — what an edge **does**. Eight hues that stay apart at the
  11px socket size on the dark canvas.

They deliberately share no values: a yellow node beside a yellow wire implied a
relationship that was not there.

Three places used to hold their own copy of the node colours — the toolbox in
Tailwind classes, every template in hex literals, and `RESOURCE_COLORS` — and
they had drifted. The toolbox now reads the palette, the 33 hex literals are
gone from the templates, and `makeNode` applies identity and colour *after*
spreading caller fields so stale data cannot override it.

**Edges now terminate on the socket for their own connection type.** `makeEdge`
sets `sourceHandle`/`targetHandle`; without them React Flow fell back to the
node's first handle, so every incoming edge piled onto the same point and the
coloured sockets meant nothing. Sockets are spaced in fixed 16px steps below the
header rather than as a percentage of node height, which put five of them 13px
apart on a collapsed card.

`isValidConnection` on the canvas rejects a connection **while it is being
dragged** — both ends must agree on the type — so the line refuses to snap
instead of being accepted and then undone. `onConnectEnd` explains the refusal.

The graph is framed against the canvas area the toolbox is not covering:
`fitView` centres in the full viewport, which tucked the leftmost nodes
underneath it.

No emoji anywhere in the app; the four template icons and the remaining glyph
buttons are lucide icons.

---

## 10. Helm, rethought

Three real defects, not styling:

1. **Helm ignored the cluster you picked.** Every Helm action built its config
   from `cli.New()`, which reads the ambient `KUBECONFIG` and its
   *current-context*. Choosing a context on the Connect page changed where
   manifests were applied but not where charts were installed — you could
   install into a cluster you were not looking at. `internal/helm` now takes the
   active `*k8s.Client` and adapts its REST config into what Helm expects.
2. **`chartVersion` was silently dropped.** The frontend sent it; the request
   struct had no field for it. Pinning a version did nothing.
3. **Installing mutated your Helm configuration.** Every install appended four
   repositories to `repositories.yaml` and downloaded their indexes. Charts are
   now located by repository URL, the way `helm install --repo` does, and
   nothing is written to your config.

**Helm also joins the review flow.** `POST /api/helm/template` renders a chart
without installing it, and `compile` returns that output as `helmYaml` — kept
separate from `yaml` on purpose, because applying it as plain YAML would create
every resource twice, once owned by k8n and once by Helm. So the preview shows
what a chart will create; apply installs it as a release.

## 11. The assistant is a team

One model holding every tool answered "why is this pod failing" by proposing a
graph change. It is now a supervisor with two specialists, each with a narrow
brief and only the tools that brief needs:

- **inspector** — reads the cluster and reports. Cannot change anything.
- **architect** — designs a canvas change and proposes it. One tool.

The supervisor sees each as a single tool and decides who to ask. Nested calls
stream with the specialist's name attached, so the trace shows who did what
instead of a black box.

**Proposals are verified before the user sees them.** `propose_graph_patch`
applies the patch to a copy of the graph, compiles it, and returns a failure to
the architect to fix. Compiler warnings are passed back too. The gate is
deterministic — no second model reviewing the first.

## 12. k8n as an MCP client

k8n was already an MCP *server*. It is now also a client: point it at servers
you already run via `K8N_MCP_SERVERS` and their tools join the assistant's own.
Same config shape as every other MCP client, both transports (stdio and
streamable HTTP), tools namespaced `server__tool`. A server that fails to start
is logged and skipped.

### Verified

- Connected to k8n's own MCP binary as an external server: 6 tools discovered in
  read-only mode, a deliberately broken entry reported and skipped, a disabled
  entry ignored, and `/api/ai/status` reporting both.
- `helm/template` rendered bitnami/nginx 18.1.0 from its repository URL with no
  cluster: 6 objects, `replicaCount: 2` honoured, and **no `repositories.yaml`
  written**.
- A graph with two Helm nodes compiled to 3 applied objects plus 10 preview-only
  objects; `architecture: standalone` produced one StatefulSet instead of two,
  and the chart was pinned to the requested 20.1.0. The node with no chart
  produced a warning rather than silence.
- Without a cluster, install and list return 503 rather than reaching for the
  ambient kubeconfig.

### Not verified

The agent team and the patch verification gate need `GEMINI_API_KEY`, which is
not set here. The delegation wiring compiles and the gate's compile step is the
same `BuildManifests` covered elsewhere, but no turn has actually run.
