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

1.  **Dynamic Rendering:** A single `GenericCRDNode` component.

2.  **Input:** Accepts a `schema` prop (JSON Schema) from the backend.

3.  **Form Generation:** Uses `@rjsf/core` (React JSON Schema Form) to render inputs automatically.

  

### B. The "Simplified Interface" (Abstraction Layer)

To avoid overwhelming users with raw YAML, nodes have two modes:

-   **Face:** High-level inputs (e.g., "Image", "Replicas", "Port").

-   **Belly:** Hidden "Advanced" tab with the full generated form.

-   **Mapper:** Javascript logic maps simplified inputs to the complex K8s spec.

  

### C. Wiring & Logic

Connections represent **Dependencies** or **Data Flow**.

-   **Dependency Edge:** "Service B waits for DB A".

-   **Data Edge:** "Inject `ServiceNode.status.ClusterIP` into `DeploymentNode.env.DB_HOST`".

-   **Implementation:** A robust variable substitution system (e.g., `${NodeID.field}`).

  

---

  

## 3. Backend: The Controller

  

The Go backend is the engine validating and applying changes.

  

### A. Discovery & CRDs

-   **Library:** `k8s.io/client-go/discovery`

-   **Mechanism:** On startup, we query the API Server for all `GroupVersionKinds` (GVKs) and cache their OpenAPIV3 schemas.

-   **Challenge:** Recursively parsing deeply nested schemas to send a flat, usable structure to the frontend.

  

### B. Helm Integration (The Beast)

-   **Library:** `helm.sh/helm/v3/pkg/action`

-   **Strategy:** Import Helm as a library (no CLI calls).

-   **Capabilities:** `Install`, `Upgrade`, `Rollback`, and `GetRelease` directly from Go memory.

-   **Chart Management:** Fetch `values.yaml` from Helm repos to generate UI node inputs.

  

### C. Real-time Status via WebSockets

-   **Mechanism:** **Shared Informer** in Go.

-   **Flow:** K8s Event -> Informer -> WebSocket Push -> React Flow Node Update (Green/Red border).

  

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

  

## **Phase 1: The "Hello Cluster" Core (Weeks 2-4)**

  

_Goal: Authenticate with a cluster and render a read-only graph of existing resources._

  

### **1.1. Authentication & Connectivity**

- [ ] **Backend:** Implement a Kubeconfig loader.

    - _Dev Mode:_ Load from `~/.kube/config`.
    - _Prod Mode:_ ServiceAccount token injection.

- [ ] **Frontend:** Create a "Connect Cluster" screen (upload kubeconfig or input context name).

### **1.2. The Discovery Engine (Backend)**

  

- [ ] Implement `DiscoveryClient` in Go to fetch all available API groups (AppsV1, BatchV1, etc.).

- [ ] Build a "Resource Lister": Fetch all Pods, Services, and Deployments in the `default` namespace.

  

### **1.3. The Visualizer (Frontend)**

  

- [ ] Initialize **React Flow** canvas.

- [ ] **Auto-Layout:** Create a function that takes the list of K8s resources and positions them on the canvas so they don't overlap (use `dagre` or `elkjs` libraries).

- [ ] **Dependency Wiring:**

    - Detect relationships: If a Service selects `app=frontend` and a Deployment has label `app=frontend`, draw a line between them.

  
  

---

  

## **Phase 2: The "Comfy" Editor & Logic (Weeks 5-8)**

  

_Goal: Create new resources using the visual interface._

  

### **2.1. The Generic Node System**

  

- [ ] **Schema Fetcher:** Backend endpoint to retrieve the `OpenAPIV3Schema` for any resource (e.g., `Deployment`).

- [ ] **Dynamic Form:** Integrate `@rjsf/core` (React JSON Schema Form).

  

    - _Logic:_ When a user drags a "Deployment" node, fetch schema -> render form inside the node's side panel.

  

### **2.2. The "Simplified Interface" Layer**

  

- [ ] **Abstraction Maps:** Create a `templates/` directory in your backend.

    - Define a "Simple Web Server" template that requires only `image` and `port`.

- [ ] **Transformer:** Write the Go logic to inflate this simple input into full K8s YAML.

    - _Input:_ `{ "image": "nginx", "port": 80 }`

    - _Output:_ `Deployment (replicas: 1...)` + `Service (ClusterIP...)`.

  

### **2.3. State Management (The "Apply" Button)**

  

- [ ] **Graph-to-YAML Compiler:** Traverse the React Flow graph and generate a multi-doc YAML string.

- [ ] **Dry Run:** Send YAML to backend -> Run `kubectl apply --dry-run=server` -> Return errors to UI.

- [ ] **Real Apply:** Execute the apply via `dynamicClient` in Go.

  

---

  

## **Phase 3: The CRD & Helm Deep Dive (Weeks 9-11)**

  

_Goal: Support the complex, custom parts of Kubernetes._

  

### **3.1. CRD First-Class Support**

  

- [ ] **Watcher:** Backend watches for `CustomResourceDefinitions` events. If a user installs "CertManager", the "Certificate" node type should instantly appear in the UI toolbox.

- [ ] **Generic Controller:** Ensure your "Apply" logic works for resources your code has never seen before (using `unstructured.Unstructured`).

  
  

### **3.2. Helm Integration**

  

- [ ] **Chart Repository Browser:** UI to search Artifact Hub or local repos.

- [ ] **The "Helm Node":**

    - This is a special node. It doesn't represent one resource; it represents a _Release_.

    - Input: `values.yaml` (use Monaco Editor for this).

- [ ] **Backend SDK:**

    - Implement `action.Install` and `action.Upgrade`.

    - _Critical:_ Handle the "Wait" flag so the UI shows a spinner until the chart is fully ready.

  

---

  

## **Phase 4: Real-Time Operations & Polish (Weeks 12-14)**

  

_Goal: Make it feel alive and usable for debugging._

  

### **4.1. The Feedback Loop (WebSockets)**

  

- [ ] **Informer Factory:** Start Go Informers for visible resources.

- [ ] **Status Pushing:**

    - If a Pod turns to `CrashLoopBackOff`, push a message to the UI.

    - Update the Node border color to Red.

    - Show the simplified error message on hover.

  

### **4.2. Terminal & Logs**

  

- [ ] **Log Stream:** Click a Pod Node -> Open bottom panel -> Stream logs via WebSocket.

- [ ] **Shell Access:** Integrate `xterm.js` on the frontend and `SPDY` executor on the backend for `kubectl exec` capabilities.

  
  

---

  

## **Phase 5: Advanced Features (The "Wow" Factor) (Week 15+)**

  

### **5.1. "Smart Connections"**

  

- [ ] Implement logic where dragging a wire from a **Service Node** to a **Deployment Node** automatically prompts: _"Do you want to inject this Service's DNS name as an Environment Variable?"_

  

### **5.2. AI Integration (Optional but recommended)**

  

- [ ] Add a "Magic Wand" button.

- [ ] Prompt: "Make a high-availability Redis cluster."

- [ ] Backend calls LLM -> Returns JSON Graph -> UI renders the nodes.

  

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