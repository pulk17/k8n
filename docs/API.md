# k8n API Documentation

This document describes the REST API endpoints provided by the k8n backend.

## Base URL

```
http://localhost:8080
```

## Authentication

Currently, k8n uses your local kubectl configuration for authentication. No additional API authentication is required in development mode.

## Endpoints

### Health Check

#### `GET /health`

Check the health status of the API and its dependencies.

**Response:**
```json
{
  "status": "ok",
  "time": 1234567890,
  "database": "connected",
  "kubernetes": "connected",
  "k8s_version": "v1.28.0"
}
```

---

### Cluster Management

#### `GET /api/cluster/contexts`

List all available Kubernetes contexts from your kubeconfig.

**Response:**
```json
[
  "minikube",
  "docker-desktop",
  "production-cluster"
]
```

#### `POST /api/cluster/connect`

Connect to a specific Kubernetes context.

**Request Body:**
```json
{
  "context": "minikube"
}
```

**Response:**
```json
{
  "status": "connected",
  "context": "minikube",
  "version": "v1.28.0"
}
```

#### `GET /api/cluster/resources`

Get all resources from the connected cluster.

**Response:**
```json
[
  {
    "kind": "Deployment",
    "name": "nginx",
    "namespace": "default",
    "uid": "abc-123-def",
    "status": "Running",
    "labels": {
      "app": "nginx"
    },
    "replicas": 3,
    "image": "nginx:latest"
  }
]
```

#### `GET /api/cluster/crds`

Get all Custom Resource Definitions from the cluster.

**Response:**
```json
[
  {
    "name": "certificates.cert-manager.io",
    "group": "cert-manager.io",
    "version": "v1",
    "kind": "Certificate"
  }
]
```

---

### Schema Discovery

#### `GET /api/schema/:kind`

Get the OpenAPI v3 schema for a specific Kubernetes resource kind.

**Parameters:**
- `kind` (path): The Kubernetes kind (e.g., "Deployment", "Service")

**Response:**
```json
{
  "type": "object",
  "properties": {
    "apiVersion": { "type": "string" },
    "kind": { "type": "string" },
    "metadata": { "type": "object" },
    "spec": {
      "type": "object",
      "properties": {
        "replicas": { "type": "integer" },
        "selector": { "type": "object" }
      }
    }
  }
}
```

---

### Resource Application

#### `POST /api/graph/apply`

Apply resources to the cluster. Supports dry-run mode.

**Query Parameters:**
- `dryRun` (optional): Set to "true" for validation without applying

**Request Body:**
```json
{
  "yaml": "apiVersion: apps/v1\nkind: Deployment\n..."
}
```

**Success Response:**
```json
{
  "success": true
}
```

**Error Response:**
```json
{
  "success": false,
  "errors": [
    {
      "resource": "nginx-deployment",
      "message": "Invalid image name"
    }
  ]
}
```

---

### Resource Deletion

#### `DELETE /api/resource/delete`

Delete a specific resource from the cluster.

**Request Body:**
```json
{
  "kind": "Deployment",
  "name": "nginx",
  "namespace": "default"
}
```

**Response:**
```json
{
  "message": "Resource deleted successfully"
}
```

---

### Graph Persistence

#### `POST /api/graph/save`

Save a workflow graph to the database.

**Request Body:**
```json
{
  "id": "uuid-or-null",
  "name": "My Workflow",
  "namespace": "default",
  "graph_json": {
    "nodes": [...],
    "edges": [...]
  }
}
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### `GET /api/graph/:id`

Load a saved workflow graph from the database.

**Parameters:**
- `id` (path): The graph UUID

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "My Workflow",
  "namespace": "default",
  "graph_json": {
    "nodes": [...],
    "edges": [...]
  },
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-02T00:00:00Z"
}
```

#### `GET /api/graph/list`

List all saved workflow graphs.

**Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "My Workflow",
    "namespace": "default",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-02T00:00:00Z"
  }
]
```

---

### Helm Integration

#### `GET /api/helm/search`

Search for Helm charts.

**Query Parameters:**
- `query` (optional): Search term

**Response:**
```json
[
  {
    "name": "nginx",
    "version": "1.0.0",
    "description": "NGINX web server",
    "repo": "bitnami"
  }
]
```

#### `POST /api/helm/install`

Install a Helm chart.

**Request Body:**
```json
{
  "releaseName": "my-nginx",
  "chartName": "bitnami/nginx",
  "namespace": "default",
  "valuesYaml": "replicaCount: 3"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Chart installed successfully"
}
```

---

### Mapping

#### `POST /api/mapper/:kind`

Convert simplified input to full Kubernetes YAML.

**Parameters:**
- `kind` (path): The Kubernetes kind

**Request Body:**
```json
{
  "name": "nginx",
  "namespace": "default",
  "image": "nginx:latest",
  "replicas": 3
}
```

**Response:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
  namespace: default
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:latest
```

---

## Error Responses

All endpoints may return error responses in the following format:

```json
{
  "error": "Error message",
  "details": "Detailed error information"
}
```

Common HTTP status codes:
- `200` - Success
- `400` - Bad Request (invalid input)
- `404` - Not Found
- `500` - Internal Server Error

---

## WebSocket (Coming Soon)

### `WS /ws/status`

Real-time status updates for cluster resources.

**Message Format:**
```json
{
  "type": "update",
  "resource": {
    "kind": "Pod",
    "name": "nginx-abc123",
    "namespace": "default",
    "status": "Running"
  }
}
```

---

For the complete OpenAPI specification, see [openapi.yaml](openapi.yaml).
