# k8n - Visual Kubernetes IDE

> A ComfyUI-inspired visual interface for Kubernetes — design, deploy, and manage your cluster with drag-and-drop simplicity.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 🚀 Quick Start

### Development (One Command)

```bash
npm run dev
```

Opens at **http://localhost:3000** — Go API on `:8080`, Next.js on `:3000` with hot-reload.

### Production (Docker — One Command)

```bash
docker-compose -f docker-compose.prod.yml up --build -d
```

Opens at **http://localhost** — everything behind Nginx on port 80.

### Windows Users

```powershell
# Development
.\start.bat

# Production
.\deploy.ps1
```

---

## 📋 Prerequisites

| Tool | Required For | Install |
|------|-------------|---------|
| **Node.js 18+** | Development | [nodejs.org](https://nodejs.org/) |
| **Go 1.25+** | Development | [golang.org](https://golang.org/dl/) |
| **air** | Dev hot-reload | `go install github.com/cosmtrek/air@latest` |
| **Docker** | Production deploy | [docker.com](https://docs.docker.com/get-docker/) |
| **kubectl** | K8s cluster access | [kubernetes.io](https://kubernetes.io/docs/tasks/tools/) |

---

## 🏗️ Project Structure

```
k8n/
├── apps/
│   ├── api/                          # ── Go Backend ──────────────────
│   │   ├── main.go                   # Entry point: HTTP server, routes, CORS, MCP mount
│   │   ├── Dockerfile                # Multi-stage build → ~30MB Alpine image
│   │   ├── .air.toml                 # Hot-reload config for development
│   │   ├── .dockerignore             # Excludes binaries/tmp from Docker build
│   │   ├── go.mod / go.sum           # Go module dependencies
│   │   ├── package.json              # npm scripts: "dev" (air), "build" (go build)
│   │   └── internal/
│   │       ├── handlers/
│   │       │   ├── cluster.go        # GET /api/cluster/resources — fetches Pods, Deployments,
│   │       │   │                     #   Services, etc. concurrently with 15s timeout
│   │       │   ├── crd.go            # GET /api/cluster/crds — discovers Custom Resource Definitions
│   │       │   ├── apply.go          # POST /api/graph/apply — compiles graph → YAML → kubectl apply
│   │       │   ├── delete.go         # DELETE /api/resource/delete — deletes K8s resources
│   │       │   ├── graph.go          # CRUD for saved workflow graphs (PostgreSQL)
│   │       │   ├── helm.go           # Helm chart search configuration
│   │       │   ├── helm_config.go    # Helm action configuration helper
│   │       │   ├── helm_install.go   # POST /api/helm/install — installs Helm charts
│   │       │   ├── helm_releases.go  # Full Helm release lifecycle (list/get/upgrade/rollback/delete)
│   │       │   ├── compile.go        # POST /api/graph/compile — whole-graph → YAML,
│   │       │   │                     #   resolving selectors/backends/mounts from edges
│   │       │   ├── graphmodel.go     # Graph/node/edge model and edge resolver
│   │       │   ├── logs.go           # GET /api/logs/... and /api/events/...
│   │       │   ├── diagnose.go       # GET /api/diagnose/:namespace — health checks
│   │       │   ├── ai.go             # /api/ai/* — assistant transport (SSE)
│   │       │   ├── aiteam.go         # Supervisor + inspector/architect agents;
│   │       │   │                     #   compiles a proposal before it is shown
│   │       │   ├── helm.go           # Helm routes, bound to the active cluster
│   │       │   ├── metrics.go        # GET /api/metrics/* — pod CPU/memory via metrics-server
│   │       │   └── schema.go         # GET /api/schema/:kind — OpenAPI schema for resource kinds
│   │       ├── k8s/
│   │       │   └── client.go         # K8s client initialization (kubeconfig / in-cluster)
│   │       ├── ai/
│   │       │   ├── gemini.go         # Gemini client and tool-calling loop
│   │       │   └── team.go           # Agents exposed to the supervisor as tools
│   │       ├── helm/
│   │       │   └── helm.go           # Helm against the connected cluster, not $KUBECONFIG
│   │       ├── mcpclient/
│   │       │   └── client.go         # Tools from external MCP servers (K8N_MCP_SERVERS)
│   │       └── mcpserver/
│   │           └── server.go         # MCP tools (stdio via cmd/k8n-mcp, HTTP at /mcp)
│   │
│   └── web/                          # ── Next.js Frontend ────────────
│       ├── Dockerfile                # Multi-stage build → standalone Node.js server
│       ├── .dockerignore             # Excludes node_modules/.next from Docker build
│       ├── next.config.ts            # Next.js config (standalone output for Docker)
│       ├── package.json              # Dependencies: React Flow, Zustand, Monaco Editor
│       ├── tailwind.config.ts        # Tailwind CSS configuration
│       ├── tsconfig.json             # TypeScript configuration
│       ├── app/
│       │   ├── layout.tsx            # Root layout (fonts, metadata)
│       │   ├── page.tsx              # Landing page → redirects to /canvas
│       │   ├── globals.css           # Global styles, Tailwind imports
│       │   ├── canvas/
│       │   │   └── page.tsx          # Main IDE canvas — React Flow graph editor
│       │   ├── connect/
│       │   │   └── page.tsx          # Cluster connection page — context selection
│       │   ├── deployed/
│       │   │   └── page.tsx          # Deployed resources viewer — live cluster state
│       │   └── help/
│       │       └── page.tsx          # Help & keyboard shortcuts reference
│       ├── components/
│       │   ├── K8sNode.tsx           # Core: visual node for each K8s resource type
│       │   ├── Dialogs.tsx           # Toasts and confirm dialog (mounted once in layout)
│       │   ├── YamlPreview.tsx       # Review the compiled YAML before it reaches the cluster
│       │   ├── AIPanel.tsx           # Gemini assistant; proposes graph patches you accept
│       │   ├── ResourceToolbox.tsx   # Sidebar: draggable resource palette
│       │   ├── WorkflowManager.tsx   # Modal: save/load/import/export workflows
│       │   ├── HelmDashboard.tsx     # Panel: search and install Helm charts
│       │   ├── HelmReleaseManager.tsx# Panel: manage installed Helm releases
│       │   ├── PodMetricsPanel.tsx   # Panel: real-time CPU/memory for a pod
│       │   ├── ResourceMonitoringDashboard.tsx  # Dashboard: resource metrics overview
│       │   ├── KeyboardShortcuts.tsx # Modal: keyboard shortcuts help
│       │   ├── ApiConnectionError.tsx# Error state: API unreachable
│       │   └── DevModeIndicator.tsx  # Dev: shows development mode banner
│       ├── lib/
│       │   ├── api.ts               # API client: shared request helper and every endpoint
│       │   ├── ai.ts                # SSE client for the assistant
│       │   ├── connections.ts       # Single source of truth for what connects to what
│       │   ├── constants.ts         # Resource colors, type definitions
│       │   ├── dialog.ts            # notify() / confirmAction() — replaces alert/confirm
│       │   ├── dockerfile.ts        # Sketches a workflow from a Dockerfile
│       │   ├── edges.ts             # Derives edges from real cluster references
│       │   ├── graph.ts             # NodeData type; makeNode/makeEdge used everywhere
│       │   ├── layout.ts            # Dagre auto-layout for graph nodes
│       │   ├── nodeSchema.ts        # Per-kind editor fields and drop-in defaults
│       │   ├── templates.ts         # Starter workflow templates (Nginx, Redis, etc.)
│       │   └── workflows.ts         # Saving: Postgres when present, browser otherwise
│       └── store/
│           └── canvasStore.ts       # Zustand store: nodes, edges, undo/redo, selection
│
├── deploy/
│   ├── aws/
│   │   ├── main.tf                  # Terraform: VPC, ALB, ECS Fargate, RDS PostgreSQL
│   │   └── deploy.sh               # Automated: build → push → terraform apply
│   └── docker/
│       └── nginx.conf               # Nginx reverse proxy: routes /api/* → API, /* → Web
│
├── docs/
│   ├── API.md                       # REST API and MCP reference
│   └── graph-schema.json            # JSON schema for workflow graph format
│
├── docker-compose.yml               # Development: PostgreSQL only
├── docker-compose.prod.yml          # Production: Nginx + API + Web + PostgreSQL
├── deploy.ps1                       # Windows PowerShell deployment script
├── init-db.sql                      # Database schema (graphs table)
├── .env.example                     # Environment variables template
├── package.json                     # Turborepo root: workspaces, dev/build/lint
├── turbo.json                       # Turborepo pipeline configuration
├── start.bat                        # Windows: start dev environment
├── start.sh                         # Linux/Mac: start dev environment
├── stop.sh                          # Linux/Mac: stop background processes
└── README.md                        # This file
```

---

## 🖥️ Development Setup

### First Time

```bash
# 1. Clone
git clone https://github.com/yourusername/k8n.git && cd k8n

# 2. Install dependencies
npm install

# 3. Install Go hot-reload tool
go install github.com/cosmtrek/air@latest

# 4. Create environment file
cp .env.example .env

# 5. (Optional) Start database for workflow persistence
docker-compose up -d

# 6. Start everything
npm run dev
```

### Daily Development

```bash
npm run dev          # Starts API + Frontend with hot-reload
```

| Service | URL | Hot-reload |
|---------|-----|-----------|
| Frontend | http://localhost:3000 | ✅ via Turbopack |
| API | http://localhost:8080 | ✅ via air |
| Database | localhost:5432 | N/A |

### Manual Start (Two Terminals)

```bash
# Terminal 1 — Backend
cd apps/api && air

# Terminal 2 — Frontend
cd apps/web && npm run dev
```

---

## 🐳 Deployment

### Option 1: Docker Compose (Recommended)

Deploy the entire stack with a single command:

```bash
docker-compose -f docker-compose.prod.yml up --build -d
```

This starts:
- **Nginx** — reverse proxy on port 80
- **Go API** — backend on internal port 8080
- **Next.js** — frontend on internal port 3000
- **PostgreSQL** — database on port 5432

Access at **http://localhost**.

#### Windows (PowerShell)

```powershell
# Deploy
.\deploy.ps1

# Deploy with custom DB password
.\deploy.ps1 -DbPassword "my-secure-password"

# Deploy on custom port
.\deploy.ps1 -Port 8888

# Rebuild everything from scratch
.\deploy.ps1 -Rebuild

# Tear down
.\deploy.ps1 -Teardown
```

#### Linux/Mac (Bash)

```bash
# Deploy
POSTGRES_PASSWORD=secure123 docker-compose -f docker-compose.prod.yml up --build -d

# Tear down
docker-compose -f docker-compose.prod.yml down -v
```

#### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_PASSWORD` | `k8npassword` | PostgreSQL password |
| `KUBECONFIG_PATH` | `~/.kube` | Path to kubeconfig on host |
| `K8N_PORT` | `80` | Port to expose k8n on |
| `ALLOWED_ORIGINS` | localhost | Extra CORS origins (comma-separated) |
| `NEXT_PUBLIC_API_URL` | (empty) | Leave empty — the browser calls Next.js, which proxies to the API |
| `API_BACKEND_URL` | `http://localhost:8080` | Where Next.js forwards `/api/*` |
| `GEMINI_API_KEY` | (empty) | Enables the AI assistant; hidden when unset |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model used by the assistant |
| `K8N_MCP_READONLY` | `false` | Drop the MCP write tools |

### Option 2: AWS (ECS Fargate)

Full Terraform setup in `deploy/aws/`:

```bash
cd deploy/aws
terraform init
terraform apply -var="db_password=secure-password"
```

Or use the automated script:

```bash
chmod +x deploy/aws/deploy.sh
./deploy/aws/deploy.sh us-east-1 "secure-password"
```

See [deploy/aws/main.tf](deploy/aws/main.tf) for full infrastructure details (VPC, ALB, ECS, RDS).

### Option 3: Any Server with Docker

```bash
# On your server
git clone https://github.com/yourusername/k8n.git && cd k8n
docker-compose -f docker-compose.prod.yml up --build -d
```

Works on any machine with Docker installed — EC2, DigitalOcean, Hetzner, etc.

---

## ⚡ Features

### Visual Canvas
- **Drag & Drop** — add Deployments, Services, ConfigMaps from a toolbox
- **Smart Connections** — color-coded edges show resource relationships
- **Auto-Layout** — Dagre-powered automatic node arrangement
- **Real-Time Status** — live resource health indicators (Running/Pending/Failed)
- **Pod Metrics** — click any pod for real-time CPU/Memory graphs

### Cluster Integration
- **Multi-Context** — connect to any kubectl context
- **Live Import** — load existing cluster resources onto canvas
- **One-Click Deploy** — apply changes directly to your cluster
- **Namespace Filtering** — focus on specific namespaces
- **HPA Support** — auto-scaling with `autoscaling/v2`

### Helm Integration
- **Chart Search** — browse and search Helm charts
- **Visual Deploy** — add Helm releases as canvas nodes
- **Full Lifecycle** — upgrade, rollback, uninstall from the UI

### Workflow Management
- **Save & Load** — persist workflows to PostgreSQL
- **Templates** — starter workflows (Nginx, Redis, etc.)
- **Export/Import** — share workflows as JSON
- **Undo/Redo** — `Ctrl+Z` history
- **Preview before apply** — compile the graph, read the manifest, dry-run, then apply

### AI Assistant (optional)
- **Ask about your cluster** — reads resources, logs and events to answer questions
- **Diagnose** — deterministic checks for crash loops, image pull failures, OOM
  kills, unschedulable pods, unbound volumes, and Services whose selector matches
  no pods — then explains the cause
- **Propose changes** — the assistant edits the *graph*, not YAML; you accept or
  reject each proposal, and nothing reaches the cluster without your apply

Set `GEMINI_API_KEY` to enable it. Without a key the AI surfaces are hidden and
the rest of k8n is unchanged.

### MCP Server
k8n speaks the [Model Context Protocol](https://modelcontextprotocol.io), so
Claude Code, Claude Desktop and other MCP clients can drive your cluster through
the same validated paths the UI uses.

```bash
# Build the stdio server
cd apps/api && go build -o k8n-mcp ./cmd/k8n-mcp

# Register it with Claude Code
claude mcp add k8n -- /absolute/path/to/k8n-mcp
```

A running k8n also serves MCP over streamable HTTP at `/mcp`.

| Tool | |
|---|---|
| `list_contexts`, `use_context` | kubeconfig contexts |
| `list_resources` | resources with status and their references |
| `get_logs` | pod logs (`previous: true` for crash loops) |
| `get_events` | events for a namespace or object |
| `diagnose` | the health checks described above |
| `compile_graph` | graph → YAML, no cluster needed |
| `apply_yaml` | server-side apply — **dry-run by default** |
| `delete_resource` | delete (refuses protected system resources) |

`apply_yaml` only makes a real change when explicitly passed `dryRun: false`.
Set `K8N_MCP_READONLY=true` to drop the write tools entirely — recommended for
anything reachable beyond localhost.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save workflow |
| `Ctrl+R` | Refresh from cluster |
| `Ctrl+Z` | Undo |
| `Delete` | Remove selected node |
| `?` | Show keyboard shortcuts |

---

## 🔧 Architecture

```
┌─────────────────────────────────────────────┐
│                  Browser                     │
│  ┌─────────────────────────────────────┐    │
│  │  Next.js 16 (React 19 + React Flow) │    │
│  │  Zustand State · Monaco Editor      │    │
│  └──────────────┬──────────────────────┘    │
└─────────────────┼───────────────────────────┘
                  │ HTTP/REST
┌─────────────────┼───────────────────────────┐
│  Nginx (prod)   │                            │
│  ┌──────────────▼──────────────────────┐    │
│  │  Go API (Gin)                        │    │
│  │  ├── Cluster handlers (concurrent)   │    │
│  │  ├── Helm SDK integration            │    │
│  │  ├── Graph persistence (PostgreSQL)  │    │
│  │  └── Metrics aggregation             │    │
│  └──────┬──────────────┬───────────────┘    │
│         │              │                     │
│  ┌──────▼─────┐  ┌─────▼────────┐           │
│  │ PostgreSQL  │  │ K8s API      │           │
│  │ (graphs)    │  │ (client-go)  │           │
│  └─────────────┘  └──────────────┘           │
└──────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, React Flow, Zustand, Tailwind CSS, Monaco (YAML preview) |
| Backend | Go 1.25+, Gin, client-go, Helm SDK |
| AI | Google Gemini (`google.golang.org/genai`), optional |
| Agents | MCP server (`modelcontextprotocol/go-sdk`), stdio + streamable HTTP |
| Database | PostgreSQL 15 |
| DevOps | Docker, Nginx, Terraform, Turborepo |

### How the graph compiles

The canvas is compiled server-side in one pass (`POST /api/graph/compile`), so
edges resolve into real Kubernetes references rather than guesses:

| Edge | Becomes |
|---|---|
| `Service → workload` | the Service's `selector` (and `targetPort` from the container) |
| `Ingress → Service` | the Ingress backend service name and port |
| `ConfigMap/Secret → workload` | `envFrom` entries |
| `PersistentVolumeClaim → workload` | a `volume` plus its `volumeMount` |
| `HorizontalPodAutoscaler → workload` | `scaleTargetRef` |
| `ServiceAccount → workload` | `serviceAccountName` |
| `Role/ServiceAccount → RoleBinding` | `roleRef` and `subjects` |

Resources imported from a live cluster are marked as such and applied as a
**partial patch containing only the fields you edited**, so applying an imported
Deployment cannot strip probes, volumes or limits that k8n never modelled.

---

## 🔍 Troubleshooting

<details>
<summary><b>Deployed Resources page stuck on "Loading..."</b></summary>

The K8s API calls may be slow. The backend now has a 15-second timeout and fetches all resource types concurrently. If your cluster is unreachable:
```bash
kubectl cluster-info
kubectl config get-contexts
```
</details>

<details>
<summary><b>Database connection failed</b></summary>

Start PostgreSQL:
```bash
docker-compose up -d    # Development
```
Or skip it — k8n works without a database (you just can't save workflows).
</details>

<details>
<summary><b>Port 8080 already in use</b></summary>

```bash
# Windows
taskkill /F /IM main.exe

# Linux/Mac
pkill main
```
Or use `npm run dev` which handles this automatically.
</details>

<details>
<summary><b>"air: command not found"</b></summary>

```bash
go install github.com/cosmtrek/air@latest
```
Make sure `$GOPATH/bin` (or `$HOME/go/bin`) is in your PATH.
</details>

---

## 👥 Authors

- Pulkit Chauhan
- Keshav Sharma
- Denish Goyal
- Md. Shaad

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

## 📚 Documentation

- [API Reference](docs/API.md)
- [Graph Schema](docs/graph-schema.json)

---

**Made with ❤️ for the Kubernetes community**
