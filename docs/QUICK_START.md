# k8n Quick Start Guide

Get up and running with k8n in 5 minutes.

## Prerequisites Check

Before starting, ensure you have:
- ✅ Node.js 18+ (`node --version`)
- ✅ Go 1.21+ (`go version`)
- ✅ Docker (`docker --version`)
- ✅ kubectl (`kubectl version --client`)

## Installation

### Automated (Recommended)

**Linux/Mac:**
```bash
git clone https://github.com/yourusername/k8n.git
cd k8n
./install.sh
```

**Windows:**
```bash
git clone https://github.com/yourusername/k8n.git
cd k8n
install.bat
```

## Starting k8n

### Option 1: Background Mode (Linux/Mac)
```bash
./start.sh
```
This starts everything in the background and opens your browser.

### Option 2: Manual Mode
Open two terminals:

**Terminal 1 - Backend:**
```bash
cd apps/api
go run main.go
```

**Terminal 2 - Frontend:**
```bash
cd apps/web
npm run dev
```

Then open: http://localhost:3000

## Your First Workflow

### 1. Connect to Cluster
- Select your kubectl context from the dropdown
- Click "Connect to Cluster"

### 2. Create a Simple Web App

**Step 1: Add a Deployment**
- Drag "Deployment" from the toolbox
- Double-click the name → rename to "web-app"
- Click to expand
- Set Image: `nginx:latest`
- Set Replicas: `3`

**Step 2: Add a Service**
- Drag "Service" from the toolbox
- Rename to "web-service"
- Set Port: `80`

**Step 3: Connect Them**
- Drag from Service's green handle (right side)
- Connect to Deployment's green handle (left side)

**Step 4: Deploy**
- Click "Apply" button
- Wait for status to turn green

**Step 5: Verify**
```bash
kubectl get all -n default
```

You should see:
- Deployment: web-app (3/3 replicas)
- Service: web-service
- Pods: web-app-xxx (3 pods)

### 3. Save Your Work
- Press `Ctrl+S` to save
- Give it a name: "My First Workflow"

## Common Tasks

### Load Existing Resources
1. Click "Workflows" button (top-right)
2. Click "Import from Cluster"
3. Your resources appear on canvas

### Use a Template
1. Click "Workflows" button
2. Click "Example Workflow"
3. See pre-built Nginx setup

### Edit a Resource
1. Click any node to select it
2. Settings panel appears on the right
3. Edit properties
4. Click "Save"

### Delete a Resource
1. Click node to select it
2. Press `Delete` key
3. Confirm deletion

### Undo Changes
- Press `Ctrl+Z` to undo
- Works for all canvas operations

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save workflow |
| `Ctrl+R` | Refresh from cluster |
| `Ctrl+Z` | Undo |
| `Delete` | Delete selected node |
| `?` | Show shortcuts |

## Troubleshooting

### "No contexts found"
```bash
# Check kubectl is configured
kubectl config get-contexts

# Ensure backend is running
curl http://localhost:8080/health
```

### Resources not showing
```bash
# Verify you have resources
kubectl get all -n default

# Try refreshing
# Press Ctrl+R or click refresh button
```

### Can't connect to backend
```bash
# Check backend is running on port 8080
curl http://localhost:8080/health

# Check frontend .env.local
cat apps/web/.env.local
# Should have: NEXT_PUBLIC_API_URL=http://localhost:8080
```

## Next Steps

- Read the [Features Guide](../FEATURES.md) for all capabilities
- Check the [API Documentation](API.md) for integration
- See [Contributing Guide](../CONTRIBUTING.md) to contribute

## Getting Help

- 🐛 [Report Issues](https://github.com/yourusername/k8n/issues)
- 💬 [Discussions](https://github.com/yourusername/k8n/discussions)
- 📖 [Full Documentation](../README.md)

---

**Happy Kubernetes visualizing! 🎨**
