# k8n - Visual Kubernetes IDE

> A ComfyUI-inspired visual interface for Kubernetes - design, deploy, and manage your cluster with drag-and-drop simplicity.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Screenshot: Main Canvas - Coming Soon]

## 🚀 Quick Start (One Command!)

```bash
# From the project root - starts everything
npm run dev
```

This single command starts:
- ✅ Go API with hot-reload (port 8080)
- ✅ Next.js frontend (port 3000)
- ✅ Auto-rebuilds on file changes

Then open **http://localhost:3000** in your browser.

### First Time Setup

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/k8n.git
cd k8n

# 2. Install dependencies
npm install

# 3. Start database (optional - only needed for saving workflows)
docker-compose up -d

# 4. Start everything
npm run dev
```

That's it! The app will open at `http://localhost:3000`.

## 🚨 Prerequisites

Before running, make sure you have:

- **Node.js** 18+ and npm
- **Go** 1.21+
- **kubectl** configured with at least one context
- **air** (Go hot-reload tool): `go install github.com/cosmtrek/air@latest`
- **Docker** (optional - only for database/workflow persistence)
- **metrics-server** (optional - for pod metrics monitoring)

##  Getting Started in 3 Steps

```bash
# 1. Clone and install
git clone https://github.com/yourusername/k8n.git
cd k8n
npm install

# 2. Start everything (one command!)
npm run dev

# 3. Open http://localhost:3000
```

That's it! You're ready to visually design and deploy Kubernetes resources.

##  What is k8n?

k8n (Kubernetes Node) is a visual IDE that transforms Kubernetes management into an intuitive, node-based workflow. Instead of writing YAML files, you drag resources onto a canvas, connect them visually, and deploy with a single click.

Think **ComfyUI for Kubernetes** - where your infrastructure is a visual graph you can see, edit, and understand at a glance.

##  Features

###  Visual Canvas
- **Drag & Drop Interface**: Add Deployments, Services, ConfigMaps, and more from a toolbox
- **Smart Connections**: Visual edges show relationships between resources
- **Auto-Layout**: Automatically arranges resources for optimal visibility
- **Real-Time Status**: See resource health with color-coded indicators (Running, Pending, Failed)
- **Pod Metrics**: Click any Pod to view real-time CPU/Memory usage

[Screenshot: Canvas with nodes - Coming Soon]

###  Cluster Integration
- **Multi-Context Support**: Connect to any kubectl context
- **Live Import**: Load existing cluster resources onto the canvas
- **One-Click Deploy**: Apply changes directly to your cluster
- **Namespace Filtering**: Focus on specific namespaces
- **HPA Support**: Auto-scaling with correct autoscaling/v2 API

[Screenshot: Cluster connection - Coming Soon]

###  Resource Management
- **Inline Editing**: Double-click node names to rename
- **Property Panels**: Edit resource specs without touching YAML
- **Type-Safe Connections**: Only compatible resources can connect (Service → Deployment)
- **Connection Hints**: Hover over handles to see what they accept

[Screenshot: Node editing - Coming Soon]

###  Helm Integration
- **Chart Search**: Browse and search Helm charts
- **Drag & Deploy**: Add Helm releases as visual nodes
- **Values Editing**: Configure chart values in the UI

[Screenshot: Helm dashboard - Coming Soon]

###  Workflow Management
- **Save & Load**: Persist workflows to database
- **Templates**: Start with example workflows (Nginx, Redis, etc.)
- **Export/Import**: Share workflows as JSON
- **Version History**: Undo/redo with Ctrl+Z

[Screenshot: Workflow manager - Coming Soon]

###  Keyboard Shortcuts
- `Ctrl+S` - Save workflow
- `Ctrl+R` - Refresh from cluster
- `Ctrl+Z` - Undo
- `Delete` - Remove selected node
- `?` - Show keyboard shortcuts

###  Smart Features
- **Typed Connections**: ComfyUI-style color-coded connection types
  - 🔵 Blue: Network connections (Service → Deployment)
  - 🟡 Yellow: Configuration (ConfigMap → Deployment)
  - 🟢 Green: Routing (Ingress → Service)
  - 🔷 Cyan: Scaling (HPA → Deployment)
  - 🟣 Purple: Storage (PVC → Deployment)
- **Connection Validation**: Prevents invalid resource relationships
- **Status Indicators**: Real-time resource health monitoring
- **Namespace Awareness**: Visual grouping by namespace
- **Pod Metrics**: Click pods to view CPU/Memory usage in real-time

[Screenshot: Connection types - Coming Soon]

##  What's New

### Latest Updates
- ✅ **Fixed HPA**: Now uses correct `autoscaling/v2` API version
- ✅ **Pod Metrics**: Real-time CPU/Memory monitoring for all pods
- ✅ **Enhanced Resources**: Full support for StatefulSet, DaemonSet, Job, CronJob, Ingress, PVC
- ✅ **Better Errors**: Descriptive error messages with helpful hints
- ✅ **Robust Validation**: Edge-based target detection for HPA

##  Quick Start

> **New to k8n?** Check out the [Quick Start Guide](docs/QUICK_START.md) for a 5-minute tutorial!

### Prerequisites

- **Node.js** 18+ and npm
- **Go** 1.21+
- **Docker** and Docker Compose
- **kubectl** configured with at least one context
- **metrics-server** (optional, for pod metrics monitoring)

### Installation

#### Quick Start (Recommended)

```bash
# Clone and install
git clone https://github.com/yourusername/k8n.git
cd k8n
npm install

# Start database (optional - for workflow persistence)
docker-compose up -d

# Start everything
npm run dev
```

Open **http://localhost:3000** and you're ready to go!

#### What `npm run dev` does

- Starts the Go API with **hot-reload** via `air` (port 8080)
- Starts the Next.js frontend with **hot-reload** (port 3000)
- Auto-rebuilds both on file changes
- No need to manually restart anything!

#### Manual Start (Alternative)

If you prefer to run services separately:

**Terminal 1 - Backend:**
```bash
cd apps/api
air  # or: go run main.go
```

**Terminal 2 - Frontend:**
```bash
cd apps/web
npm run dev
```

### First Steps

1. **Connect to Cluster**: Select your kubectl context from the dropdown
2. **Choose a Workflow**:
   - **New Workflow**: Start with an empty canvas
   - **Example Workflow**: Try the Nginx starter template
   - **Import from Cluster**: Load your existing resources
3. **Design**: Drag resources from the toolbox, connect them visually
4. **Deploy**: Click "Apply" to deploy to your cluster

[Screenshot: Getting started flow - Coming Soon]

##  Usage Guide

### Creating a Simple Web Application

1. **Add a Deployment**
   - Drag "Deployment" from the toolbox
   - Double-click the name to rename it to "web-app"
   - Click to expand and set:
     - Image: `nginx:latest`
     - Replicas: `3`

2. **Add a Service**
   - Drag "Service" from the toolbox
   - Rename to "web-service"
   - Set Port: `80`

3. **Connect Them**
   - Drag from the Service's green output handle
   - Connect to the Deployment's green input handle

4. **Deploy**
   - Click the "Apply" button
   - Watch the status indicators turn green

5. **Verify**
```bash
kubectl get all -n default
```

### Loading Existing Resources

1. Open Workflow Manager (top-right button)
2. Click "Import from Cluster"
3. Your resources appear on the canvas
4. Edit and re-apply as needed

### Saving Your Work

- **Auto-save**: Press `Ctrl+S` anytime
- **Workflow Manager**: Access saved workflows from the manager
- **Export**: Download as JSON for sharing

##  Architecture

```
k8n/
├── apps/
│   ├── api/                 # Go backend
│   │   ├── main.go         # API server
│   │   └── internal/
│   │       ├── handlers/   # HTTP handlers
│   │       └── k8s/        # Kubernetes client
│   └── web/                # Next.js frontend
│       ├── app/            # Pages (canvas, connect, deployed)
│       ├── components/     # React components
│       ├── lib/            # Utilities (compiler, layout)
│       └── store/          # Zustand state management
├── docker-compose.yml      # PostgreSQL setup
└── init-db.sql            # Database schema
```

### Tech Stack

**Frontend**
- Next.js 14 (React)
- React Flow (Canvas)
- Zustand (State Management)
- Tailwind CSS (Styling)

**Backend**
- Go 1.21+
- Gin (HTTP Framework)
- client-go (Kubernetes SDK)
- Helm SDK

**Database**
- PostgreSQL 15

##  Configuration

### Environment Variables

Create `.env` in the root directory:

```env
# Database
DATABASE_URL=postgres://k8n:k8npassword@localhost:5432/k8n_db?sslmode=disable

# API
API_PORT=8080

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8080
```

### Kubernetes Access

k8n uses your local kubectl configuration:
- Default: `~/.kube/config`
- Supports all kubectl contexts
- Uses the same authentication as kubectl

##  Troubleshooting

### "No Kubernetes contexts found"

1. Verify kubectl is configured:
```bash
kubectl config get-contexts
```

2. Ensure backend is running:
```bash
curl http://localhost:8080/health
```

3. Check backend logs for errors

### Resources not showing

1. Click the refresh button (or press `Ctrl+R`)
2. Check namespace filter (top toolbar)
3. Verify you have resources in the cluster:
```bash
kubectl get all -n default
```

### Pod metrics not available

1. Install metrics-server:
```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

2. Verify it's working:
```bash
kubectl top nodes
kubectl top pods
```

3. For local clusters (minikube, kind), you may need to add `--kubelet-insecure-tls`:
```bash
kubectl patch deployment metrics-server -n kube-system --type='json' \
  -p='[{"op": "add", "path": "/spec/template/spec/containers/0/args/-", "value": "--kubelet-insecure-tls"}]'
```

### HPA shows "Unknown" status

1. Ensure metrics-server is installed (see above)
2. Check HPA status:
```bash
kubectl describe hpa <hpa-name>
```
3. Verify target deployment has resource requests defined

### Backend won't start

**Error: "bind: Only one usage of each socket address"**
- Port 8080 is already in use
- Kill the existing process: `taskkill /F /IM main.exe` (Windows) or `pkill main` (Linux/Mac)
- Or use `npm run dev` which handles this automatically

**Error: "air: command not found"**
- Install air: `go install github.com/cosmtrek/air@latest`
- Make sure `$GOPATH/bin` is in your PATH
- Or run manually: `cd apps/api && go run main.go`

**Other issues:**
1. Check Go version: `go version` (need 1.21+)
2. Verify database is running: `docker ps`
3. Check kubeconfig: `kubectl cluster-info`

### Frontend can't connect

1. Verify backend is on port 8080
2. Check `NEXT_PUBLIC_API_URL` in `.env`
3. Look for CORS errors in browser console


##  Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

##  License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

##  Authors

- Pulkit Chauhan
- Keshav Sharma
- Denish Goyal
- Md. Shaad

##  Acknowledgments

- Inspired by [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
- Built with [React Flow](https://reactflow.dev/)
- Powered by [Kubernetes](https://kubernetes.io/)

##  Documentation

- [Features Guide](FEATURES.md) - Comprehensive feature documentation
- [API Reference](docs/API.md) - REST API documentation
- [Contributing Guide](CONTRIBUTING.md) - How to contribute
- [Graph Schema](docs/graph-schema.json) - JSON schema for workflows
- [OpenAPI Spec](docs/openapi.yaml) - API specification

---

**Made with ❤️ for the Kubernetes community**
