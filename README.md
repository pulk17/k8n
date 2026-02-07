# k8n

> **Status:** Conceptual / MVP Phase  
> **Authors:** Pulkit Chauhan, Keshav Sharma, Denish Goyal, Md. Shaad

This project is a massive undertaking to build a **Visual IDE for Kubernetes**. It moves beyond simple dashboards (like ArgoCD or Lens) by treating the cluster state as a manipulatable graph, similar to **ComfyUI** or **n8n**, but for infrastructure.

---

## 1. Core Architecture: "The Graph Controller"

The central thesis of this project is that the **Graph IS the Logic**. We are building a **State Manager** that synchronizes a visual graph with the actual Kubernetes cluster state.

### High-Level Stack

- **Frontend:** Next.js (React) + **React Flow** (Canvas) + **Zustand** (State).
- **Backend:** **Go (Golang)**. 
    - *Why Go?* We need native Kubernetes tooling (`client-go`, `helm` SDK). Node.js wrappers are too brittle for this level of integration.
- **Database:** PostgreSQL (to persist user graphs and workflows).
- **Message Queue (Optional):** Redis (for executing complex multi-step workflows).

---

## 2. Frontend: The Visual Editor

The frontend is a **Next.js** application designed to handle complex state without UI lag.

### A. The "Generic Node" Problem
We cannot manually code a component for every K8s resource (Deployment, Service, Ingress, etc.).
**Solution: The Schema-Driven Node**
1.  **Dynamic Rendering:** A single `GenericCRDNode` component.
2.  **Input:** Accepts a `schema` prop (JSON Schema) from the backend.
3.  **Form Generation:** Uses `@rjsf/core` (React JSON Schema Form) to render inputs automatically.

### B. The "Simplified Interface" (Abstraction Layer)
To avoid overwhelming users with raw YAML, nodes have two modes:
-   **Face:** High-level inputs (e.g., "Image", "Replicas", "Port").
-   **Belly:** Hidden "Advanced" tab with the full generated form.
-   **Mapper:** Javascript logic maps simplified inputs to the complex K8s spec.

### C. Wiring & Logic
Connections represent **Dependencies** or **Data Flow**.
-   **Dependency Edge:** "Service B waits for DB A".
-   **Data Edge:** "Inject `ServiceNode.status.ClusterIP` into `DeploymentNode.env.DB_HOST`".
-   **Implementation:** A robust variable substitution system (e.g., `${NodeID.field}`).

---

## 3. Backend: The Controller

The Go backend is the engine validating and applying changes.

### A. Discovery & CRDs
-   **Library:** `k8s.io/client-go/discovery`
-   **Mechanism:** On startup, we query the API Server for all `GroupVersionKinds` (GVKs) and cache their OpenAPIV3 schemas.
-   **Challenge:** Recursively parsing deeply nested schemas to send a flat, usable structure to the frontend.

### B. Helm Integration (The Beast)
-   **Library:** `helm.sh/helm/v3/pkg/action`
-   **Strategy:** Import Helm as a library (no CLI calls).
-   **Capabilities:** `Install`, `Upgrade`, `Rollback`, and `GetRelease` directly from Go memory.
-   **Chart Management:** Fetch `values.yaml` from Helm repos to generate UI node inputs.

### C. Real-time Status via WebSockets
-   **Mechanism:** **Shared Informer** in Go.
-   **Flow:** K8s Event -> Informer -> WebSocket Push -> React Flow Node Update (Green/Red border).

---

## 4. Engineering Challenges ("The Gotchas")

### 1. The "Diff" Problem
*Scenario:* UI says `replicas: 3`, Cluster says `replicas: 5` (changed via kubectl).
*Solution:* **Live State Sync**. Always fetch the current state before applying. Show a "Diff View" (Git style) to resolve conflicts.

### 2. CORS & Proxying
*Constraint:* Browsers cannot blindly talk to the K8s API.
*Solution:* The Go Backend acts as a transparent **Proxy**. All frontend requests go to `/api/k8s/...` and are forwarded by the backend with proper auth.

### 3. Secrets Management
*Security:* Never send raw Secret values to the frontend on "Get".
*Solution:* detecting `kind: Secret` or sensitive fields in schema. Render as `*****`. Only transmit values on "Set" (Update/Create).

### 4. Namespace Isolation
*Issue:* Linking a Service in `default` to a Pod in `dev` breaks DNS.
*Solution:* Visual cues for Namespaces (Groups/Boxes) and validation rules preventing cross-namespace dependencies unless explicitly allowed.

### 5. Validation Hell
*Issue:* Connecting `Service` output to `VolumeMount` input.
*Solution:* **Socket Types**. Define inputs/outputs as strict types (`string`, `int`, `k8s-object`, `port`) and only allow compatible connections.

---

## 5. Roadmap

### Phase 1: The Viewer (MVP)
- [ ] Connect to local cluster (`~/.kube/config`).
- [ ] Visualize existing resources as Nodes.
- [ ] Auto-layout graph based on owner references.

### Phase 2: The Editor
- [ ] Edit values in Nodes (2-way binding).
- [ ] "Apply" button to run `client.Update()`.
- [ ] Basic diff viewer.

### Phase 3: The Creator (AI & Helm)
- [ ] Drag & Drop new nodes.
- [ ] **Magic Node:** AI prompt -> Graph Structure (e.g., "Create HA Redis") -> Auto-wired nodes.
- [ ] Helm Chart browser and installer.

---

## 6. Development Setup

### Backend
```bash
cd backend
go run main.go
```
*Port: 8080*

### Frontend
```bash
cd frontend
npm run dev
```
*Port: 3000*
