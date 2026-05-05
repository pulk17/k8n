# k8n Features

A comprehensive guide to all features available in k8n.

## 🎨 Visual Canvas

### Drag & Drop Interface
Add Kubernetes resources to your canvas by dragging them from the toolbox. Supported resources include:
- Deployments
- Services
- ConfigMaps
- Secrets
- StatefulSets
- DaemonSets
- Jobs
- CronJobs
- Ingress
- PersistentVolumeClaims
- HorizontalPodAutoscaler (HPA) - **Now with correct autoscaling/v2 API!**
- Helm Releases

[Screenshot placeholder]

### Smart Auto-Layout
Resources are automatically positioned using intelligent layout algorithms to prevent overlapping and optimize visibility.

[Screenshot placeholder]

### Node Customization
- **Double-click to rename**: Quickly rename any resource
- **Expand/collapse**: Click nodes to show/hide detailed properties
- **Inline editing**: Edit properties directly within nodes
- **Color coding**: Each resource type has a distinct color

[Screenshot placeholder]

## 🔌 Kubernetes Integration

### Multi-Context Support
Connect to any kubectl context configured on your system. Switch between:
- Local clusters (minikube, kind, k3s)
- Cloud providers (EKS, GKE, AKS)
- Remote clusters
- Multiple contexts simultaneously (coming soon)

[Screenshot placeholder]

### Live Cluster Import
Load existing resources from your cluster onto the canvas with one click. k8n automatically:
- Discovers all resources in selected namespaces
- Creates visual nodes for each resource
- Draws connections based on relationships
- Filters out system resources for clarity

[Screenshot placeholder]

### One-Click Deployment
Deploy your visual workflow to Kubernetes with a single click:
1. **Dry Run**: Validates resources before applying
2. **Error Detection**: Shows validation errors with clear messages
3. **Apply**: Deploys resources to your cluster
4. **Status Tracking**: Monitors deployment progress

[Screenshot placeholder]

## ⚙️ Resource Management

### Typed Connections (ComfyUI-Style)
Connections are color-coded and type-safe:

- **🔵 Blue (Network)**: Service → Deployment/Pod
  - Routes traffic to workloads
  - Validates selector matches
  
- **🟡 Yellow (Config)**: ConfigMap/Secret → Deployment
  - Injects configuration
  - Mounts volumes
  
- **🟢 Green (Routing)**: Ingress → Service
  - External routing
  - Path-based routing

- **🔷 Cyan (Scaling)**: HPA → Deployment/StatefulSet
  - Auto-scaling configuration
  - CPU/Memory based scaling

- **🟣 Purple (Storage)**: PVC → Deployment/StatefulSet
  - Persistent volume claims
  - Storage mounting

[Screenshot placeholder]

### Connection Validation
k8n prevents invalid connections:
- Only compatible resource types can connect
- Hover over handles to see accepted types
- Visual feedback for valid/invalid connections
- Automatic relationship detection

[Screenshot placeholder]

### Property Editing
Edit resource properties without touching YAML:

**Deployment Properties:**
- Name and namespace
- Container image
- Replica count
- Environment variables
- Resource limits

**Service Properties:**
- Service type (ClusterIP, NodePort, LoadBalancer)
- Port mappings
- Selectors

**ConfigMap/Secret Properties:**
- Key-value pairs
- File mounts

[Screenshot placeholder]

## 📦 Helm Integration

### Chart Search
Browse and search thousands of Helm charts:
- Search by name or keyword
- View chart details and versions
- See chart descriptions and maintainers

[Screenshot placeholder]

### Visual Helm Releases
Add Helm charts as visual nodes:
- Drag charts from the Helm dashboard
- Configure values in the UI
- Deploy with other resources
- Track release status

[Screenshot placeholder]

### Values Configuration
Edit Helm values without YAML:
- Common values exposed as form fields
- Advanced mode for full values.yaml editing
- Validation and error checking

[Screenshot placeholder]

## 💾 Workflow Management

### Save & Load Workflows
Persist your work to the database:
- **Auto-save**: Press Ctrl+S anytime
- **Named workflows**: Give meaningful names
- **Timestamps**: Track when workflows were created/modified
- **Quick access**: Load from workflow manager

[Screenshot placeholder]

### Workflow Templates
Start quickly with pre-built templates:
- **Nginx Web Server**: Deployment + Service + Ingress
- **Redis Cache**: StatefulSet + Service + ConfigMap
- **PostgreSQL Database**: StatefulSet + Service + Secret + PVC
- **Custom templates**: Create your own (coming soon)

[Screenshot placeholder]

### Export & Import
Share workflows with your team:
- **Export as JSON**: Download workflow file
- **Import from JSON**: Load shared workflows
- **Export as YAML**: Get raw Kubernetes manifests
- **Git integration**: Version control your workflows (coming soon)

[Screenshot placeholder]

## ⌨️ Keyboard Shortcuts

Boost productivity with keyboard shortcuts:

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save workflow |
| `Ctrl+R` | Refresh from cluster |
| `Ctrl+Z` | Undo last change |
| `Delete` | Remove selected node |
| `?` | Show keyboard shortcuts |
| `Ctrl+Scroll` | Zoom in/out |
| `Space+Drag` | Pan canvas |

[Screenshot placeholder]

## 🎯 Smart Features

### Real-Time Status Indicators
See resource health at a glance:
- **🟢 Green**: Running/Ready/Active
- **🟡 Yellow**: Pending/NotReady
- **🔴 Red**: Failed/Error/CrashLoopBackOff
- **⚪ Gray**: Unknown

Status updates automatically when resources change.

[Screenshot placeholder]

### Namespace Filtering
Focus on specific namespaces:
- Filter dropdown in toolbar
- Show all namespaces or select specific ones
- Visual grouping by namespace (coming soon)

[Screenshot placeholder]

### Connection Hints
Hover over connection handles to see:
- What resource types are accepted
- Connection type (network, config, routing)
- Example relationships

[Screenshot placeholder]

### Undo/Redo
Full history tracking:
- Undo up to 50 actions
- Redo undone actions
- Preserves entire workflow state

[Screenshot placeholder]

## 🔍 Resource Discovery

### Automatic Relationship Detection
k8n automatically detects relationships:
- Services → Deployments (via selectors)
- Deployments → ConfigMaps (via volume mounts)
- Deployments → Secrets (via env vars)
- Ingress → Services (via backend rules)

[Screenshot placeholder]

### CRD Support
Automatically discovers Custom Resource Definitions:
- Detects installed CRDs
- Adds them to the toolbox
- Supports any CRD schema
- Generic editing interface

[Screenshot placeholder]

## 📊 Visualization & Monitoring

### Pod Metrics Monitoring (NEW!)
Click on any Pod to view real-time resource usage:
- **CPU Usage**: Current CPU consumption in millicores
- **Memory Usage**: Current memory usage in Mi/Gi
- **Container Breakdown**: Per-container resource metrics
- **Auto-Refresh**: Updates every 5 seconds (toggleable)
- **Requirements**: Requires metrics-server installed in cluster

[Screenshot placeholder]

### Multiple View Modes
- **Canvas View**: Main visual editor
- **Deployed View**: See what's running in your cluster
- **Help View**: Documentation and guides
- **Metrics Panel**: Real-time pod monitoring (click any pod)

[Screenshot placeholder]

### Resource Grouping
Organize resources visually:
- Group by namespace
- Group by application
- Custom grouping (coming soon)

[Screenshot placeholder]

### Zoom & Pan
Navigate large workflows:
- Zoom with Ctrl+Scroll
- Pan with Space+Drag
- Fit to screen button
- Mini-map (coming soon)

[Screenshot placeholder]

## 🚀 Advanced Features

### Dry Run Validation
Test before deploying:
- Server-side validation
- Shows exactly what will be created/updated
- Catches errors before they happen
- No impact on cluster

[Screenshot placeholder]

### Error Handling
Clear, actionable error messages:
- Resource-specific errors
- Line numbers for YAML errors
- Suggestions for fixes
- Links to documentation

[Screenshot placeholder]

### Dev Mode Indicator
Know your environment:
- Shows when in development mode
- Displays current cluster context
- Warns about production clusters

[Screenshot placeholder]

## ✅ Recently Added

### HorizontalPodAutoscaler Support
Full HPA support with correct API version:
- Uses `autoscaling/v2` API (fixed from experimental/v1)
- Automatic target detection from graph connections
- CPU-based scaling configuration
- Min/Max replica settings
- Visual connection to target workloads

### Pod Metrics Dashboard
Real-time resource monitoring:
- Click any Pod node to view metrics
- CPU and memory usage tracking
- Container-level breakdown
- Auto-refresh capability
- Graceful handling when metrics-server unavailable

### Enhanced Resource Support
All major Kubernetes resources now fully supported:
- StatefulSet with persistent storage
- DaemonSet for node-level services
- Job and CronJob for batch workloads
- Ingress with TLS support
- PersistentVolumeClaim for storage
- Proper API versions for all resources

### Robust Error Handling
- Descriptive error messages with hints
- Validation before deployment
- Clear feedback for missing dependencies
- Helpful suggestions for common issues

## 🔜 Coming Soon

### WebSocket Live Updates
Real-time cluster synchronization:
- Instant status updates
- Live resource changes
- Collaborative editing

### Multi-Cluster Support
Manage multiple clusters:
- Switch between clusters
- Cross-cluster deployments
- Unified view

### AI-Powered Generation
Natural language to infrastructure:
- "Create a web app with Redis"
- Automatic resource generation
- Best practice recommendations

### Cost Analysis
Understand resource costs:
- Estimated cloud costs
- Resource utilization
- Optimization suggestions

### Collaboration
Work together:
- Real-time co-editing
- Comments and annotations
- Change tracking
- Team workspaces

---

For more information, see [README.md](README.md) or visit our [documentation](https://github.com/yourusername/k8n/wiki).
