import { create } from "zustand";
import {
  Node, Edge, Connection, addEdge, applyNodeChanges, applyEdgeChanges,
  NodeChange, EdgeChange,
} from "reactflow";
import { fetchResources, fetchNamespaces, errorMessage, K8sResource } from "../lib/api";
import { WorkflowSource, loadWorkflow, saveWorkflow } from "../lib/workflows";
import { generateEdges } from "../lib/edges";
import { layoutGraph } from "../lib/layout";
import { RESOURCE_COLORS, DEFAULT_RESOURCE_COLOR } from "../lib/constants";
import { isValidConnection } from "../lib/connections";
import { NodeData, makeEdge, makeNode, nodeId } from "../lib/graph";

/** Kinds shown by default; pods and replica sets are opt-in to keep it readable. */
const PRIMARY_KINDS = new Set([
  "Deployment", "StatefulSet", "DaemonSet",
  "Service", "Ingress",
  "ConfigMap", "Secret",
  "Job", "CronJob",
  "PersistentVolumeClaim", "HorizontalPodAutoscaler", "ServiceAccount",
]);

const SYSTEM_NAMESPACES = ["kube-system", "kube-public", "kube-node-lease", "local-path-storage"];

const MAX_HISTORY = 50;

export interface CanvasState {
  nodes: Node[];
  edges: Edge[];
  namespaces: string[];
  activeNamespace: string;
  loading: boolean;
  error: string | null;
  graphId: string | null;
  graphName: string;
  selectedNodeId: string | null;
  dirty: boolean;
  showPods: boolean;
  showSystemNamespaces: boolean;
  history: { nodes: Node[]; edges: Edge[] }[];
  historyIndex: number;

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  hydrateGraph: () => Promise<void>;
  loadNamespaces: () => Promise<void>;
  setActiveNamespace: (ns: string) => void;
  setGraphName: (name: string) => void;
  setSelectedNodeId: (id: string | null) => void;
  setShowPods: (show: boolean) => void;
  setShowSystemNamespaces: (show: boolean) => void;
  updateNodeData: (nodeId: string, data: Partial<NodeData>) => void;
  /** Refreshes the status of imported nodes from the watch stream, in place. */
  applyLiveStatus: (resources: K8sResource[]) => void;
  addNode: (node: Node) => void;
  deleteNode: (nodeId: string) => void;
  /** Returns where it landed, so the UI can say so. */
  saveGraph: () => Promise<WorkflowSource>;
  loadGraph: (id: string) => Promise<void>;
  createStarterWorkflow: () => void;
  /** Replaces the canvas wholesale — templates, imports, loaded workflows. */
  setGraph: (nodes: Node[], edges: Edge[], name: string) => void;
  applyGraphPatch: (patch: GraphPatch) => { added: number; connected: number; updated: number };
  clearCanvas: () => void;
  undo: () => void;
  redo: () => void;
  saveHistory: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

/** A change the assistant proposes to the canvas. */
export interface GraphPatch {
  summary?: string;
  addNodes?: { id: string; kind: string; name: string; namespace?: string; fields?: string }[];
  addEdges?: { source: string; target: string }[];
  updateNodes?: { id: string; fields?: string }[];
}

/** The assistant sends per-kind fields as a JSON string; parse defensively. */
function parseFields(raw: unknown): Partial<NodeData> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Partial<NodeData>;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const clone = <T,>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  namespaces: [],
  activeNamespace: "all",
  graphId: null,
  graphName: "Untitled Graph",
  loading: false,
  error: null,
  selectedNodeId: null,
  dirty: false,
  showPods: false,
  showSystemNamespaces: false,
  history: [],
  historyIndex: -1,

  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  saveHistory: () => {
    const { nodes, edges, history, historyIndex } = get();
    const next = history.slice(0, historyIndex + 1);
    next.push({ nodes: clone(nodes), edges: clone(edges) });
    if (next.length > MAX_HISTORY) next.shift();
    set({ history: next, historyIndex: next.length - 1, dirty: true });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return;
    const prev = history[historyIndex - 1];
    set({
      nodes: clone(prev.nodes),
      edges: clone(prev.edges),
      historyIndex: historyIndex - 1,
      dirty: true,
    });
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;
    const next = history[historyIndex + 1];
    set({
      nodes: clone(next.nodes),
      edges: clone(next.edges),
      historyIndex: historyIndex + 1,
      dirty: true,
    });
  },

  clearCanvas: () =>
    set({
      nodes: [],
      edges: [],
      graphName: "Untitled Graph",
      graphId: null,
      selectedNodeId: null,
      history: [],
      historyIndex: -1,
      dirty: false,
      error: null,
    }),

  setGraphName: name => set({ graphName: name, dirty: true }),
  setSelectedNodeId: id => set({ selectedNodeId: id }),
  setShowPods: show => {
    set({ showPods: show });
    if (get().nodes.some(n => n.data?.origin === "cluster")) get().hydrateGraph();
  },
  setShowSystemNamespaces: show => {
    set({ showSystemNamespaces: show });
    if (get().nodes.some(n => n.data?.origin === "cluster")) get().hydrateGraph();
  },

  onNodesChange: changes => {
    const structural = changes.some(
      c => c.type === "remove" || c.type === "add" || c.type === "reset"
    );
    if (structural) get().saveHistory();

    set({ nodes: applyNodeChanges(changes, get().nodes) });

    // Dragging is a change worth saving, but it fires continuously, so it marks
    // the graph dirty without pushing a history entry per frame.
    if (changes.some(c => c.type === "position" && c.dragging === false)) {
      set({ dirty: true });
    }

    for (const change of changes) {
      if (change.type === "select") {
        if (change.selected) set({ selectedNodeId: change.id });
        else if (get().selectedNodeId === change.id) set({ selectedNodeId: null });
      }
      if (change.type === "remove" && get().selectedNodeId === change.id) {
        set({ selectedNodeId: null });
      }
    }
  },

  onEdgesChange: changes => {
    if (changes.some(c => c.type === "remove" || c.type === "add" || c.type === "reset")) {
      get().saveHistory();
    }
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: connection => {
    const { nodes, edges } = get();
    const source = nodes.find(n => n.id === connection.source);
    const target = nodes.find(n => n.id === connection.target);
    if (!source || !target) return;
    if (!isValidConnection(source.data.kind, target.data.kind)) return;
    if (edges.some(e => e.source === source.id && e.target === target.id)) return;

    get().saveHistory();

    // Built the same way as every other edge, so a hand-drawn connection lands
    // on the same typed socket an imported or generated one would.
    set({ edges: addEdge(makeEdge(source, target), edges) });
  },

  updateNodeData: (id, data) => {
    get().saveHistory();
    set({
      nodes: get().nodes.map(node => {
        if (node.id !== id) return node;

        const next = { ...node.data, ...data };

        // Imported resources are only ever applied as a partial patch, so we
        // record which fields the user actually touched. Without this the
        // compiler cannot tell an edit from an untouched import.
        if (node.data?.origin === "cluster") {
          const edited = { ...(node.data.__edited || {}) };
          for (const key of Object.keys(data)) {
            if (data[key] !== node.data[key]) edited[key] = true;
          }
          next.__edited = edited;
        }

        return { ...node, data: next };
      }),
      dirty: true,
    });
  },

  applyLiveStatus: resources => {
    const byUid = new Map(resources.map(r => [r.uid, r]));
    let moved = false;

    const nodes = get().nodes.map(node => {
      if (node.data?.origin !== "cluster") return node;

      const live = byUid.get(node.id);
      const status = live ? live.status : "Deleted";
      const statusMessage = live ? live.statusMessage : "No longer in the cluster";
      const readyReplicas = live ? live.readyReplicas : node.data.readyReplicas;

      if (
        node.data.status === status &&
        node.data.statusMessage === statusMessage &&
        node.data.readyReplicas === readyReplicas
      ) {
        return node;
      }

      moved = true;
      return { ...node, data: { ...node.data, status, statusMessage, readyReplicas } };
    });

    // Status is not the user's work, so it neither dirties the canvas nor lands
    // in the undo history — and an unchanged cluster must not re-render it.
    if (moved) set({ nodes });
  },

  addNode: node => {
    get().saveHistory();
    set({ nodes: [...get().nodes, node] });
  },

  deleteNode: id => {
    get().saveHistory();
    set({
      nodes: get().nodes.filter(n => n.id !== id),
      edges: get().edges.filter(e => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
    });
  },

  loadNamespaces: async () => {
    try {
      set({ namespaces: await fetchNamespaces() });
    } catch {
      // Namespaces are a convenience; a failure here should not block the canvas.
    }
  },

  hydrateGraph: async () => {
    try {
      set({ loading: true, error: null });
      const { showPods, showSystemNamespaces } = get();

      const resources = await fetchResources();

      const visible = resources.filter((r: K8sResource) => {
        if (!showSystemNamespaces && SYSTEM_NAMESPACES.includes(r.namespace)) return false;
        if (PRIMARY_KINDS.has(r.kind)) return true;
        if (showPods && (r.kind === "Pod" || r.kind === "ReplicaSet")) return true;
        return false;
      });

      // Edges are derived from the full result set so ownership chains resolve
      // even when the intermediate ReplicaSet is hidden, then filtered to what
      // is actually on screen.
      const visibleIds = new Set(visible.map(r => r.uid));
      const edges = generateEdges(resources).filter(
        e => visibleIds.has(e.source) && visibleIds.has(e.target)
      );

      const nodes: Node[] = visible.map(r => ({
        id: r.uid,
        type: "k8sNode",
        position: { x: 0, y: 0 },
        data: {
          ...r,
          // Marks this as live cluster state: applying it sends only edited
          // fields, so k8n cannot clobber spec it never saw.
          origin: "cluster",
          color: RESOURCE_COLORS[r.kind] || DEFAULT_RESOURCE_COLOR,
        },
      }));

      set({
        nodes: layoutGraph(nodes, edges),
        edges,
        loading: false,
        dirty: false,
        history: [],
        historyIndex: -1,
      });

      get().loadNamespaces();
    } catch (err) {
      set({ error: errorMessage(err), loading: false });
    }
  },

  setActiveNamespace: ns => set({ activeNamespace: ns }),

  saveGraph: async () => {
    const { graphId, graphName, activeNamespace, nodes, edges } = get();
    try {
      set({ loading: true, error: null });
      const saved = await saveWorkflow(
        { name: graphName, namespace: activeNamespace, nodes, edges },
        graphId
      );
      set({ graphId: saved.id, loading: false, dirty: false });
      return saved.source;
    } catch (err) {
      set({ error: errorMessage(err), loading: false });
      throw err;
    }
  },

  loadGraph: async id => {
    try {
      set({ loading: true, error: null });
      const graph = await loadWorkflow(id, id.startsWith("local-") ? "browser" : "database");
      set({
        graphId: id,
        graphName: graph.name,
        activeNamespace: graph.namespace || "all",
        nodes: graph.nodes,
        edges: graph.edges,
        loading: false,
        dirty: false,
        history: [],
        historyIndex: -1,
      });
    } catch (err) {
      set({ error: errorMessage(err), loading: false });
    }
  },

  /**
   * Applies an assistant-proposed patch to the canvas.
   *
   * This runs only after the user accepts. It goes through the normal graph
   * mutations, so the whole thing is a single undo away and the compiler sees
   * it exactly as it would see hand-drawn work.
   */
  applyGraphPatch: patch => {
    get().saveHistory();

    const nodes = [...get().nodes];
    const edges = [...get().edges];
    const ns = get().activeNamespace === "all" ? "default" : get().activeNamespace;

    // Map the assistant's temporary ids onto the real node ids we create.
    const idMap = new Map<string, string>();
    let added = 0;

    for (const spec of patch.addNodes || []) {
      if (!spec.kind || !spec.name) continue;
      const realId = nodeId(spec.kind);
      idMap.set(spec.id, realId);
      nodes.push(
        makeNode(realId, spec.kind, spec.name, spec.namespace || ns, parseFields(spec.fields))
      );
      added++;
    }

    const resolve = (id: string) => idMap.get(id) || id;
    const byId = new Map(nodes.map(n => [n.id, n]));

    let connected = 0;
    for (const edge of patch.addEdges || []) {
      const source = byId.get(resolve(edge.source));
      const target = byId.get(resolve(edge.target));
      if (!source || !target) continue;
      // The assistant proposes; the same rules still apply.
      if (!isValidConnection(source.data.kind, target.data.kind)) continue;
      if (edges.some(e => e.source === source.id && e.target === target.id)) continue;

      edges.push(makeEdge(source, target));
      connected++;
    }

    let updated = 0;
    const patched = nodes.map(node => {
      const change = (patch.updateNodes || []).find(u => resolve(u.id) === node.id);
      if (!change) return node;
      const fields = parseFields(change.fields);
      if (Object.keys(fields).length === 0) return node;
      updated++;

      const next = { ...node.data, ...fields };
      if (node.data?.origin === "cluster") {
        const edited = { ...(node.data.__edited || {}) };
        for (const key of Object.keys(fields)) edited[key] = true;
        next.__edited = edited;
      }
      return { ...node, data: next };
    });

    set({ nodes: layoutGraph(patched, edges), edges, dirty: true });
    return { added, connected, updated };
  },

  setGraph: (nodes, edges, name) =>
    set({
      nodes: layoutGraph(nodes, edges),
      edges,
      graphName: name,
      graphId: null,
      selectedNodeId: null,
      dirty: true,
      history: [],
      historyIndex: -1,
      error: null,
    }),

  createStarterWorkflow: () => {
    const ns = get().activeNamespace === "all" ? "default" : get().activeNamespace;

    const ingress = makeNode("starter-ingress", "Ingress", "nginx-ingress", ns, {
      host: "nginx.local",
      path: "/",
    });
    const service = makeNode("starter-service", "Service", "nginx-service", ns, {
      port: 80,
      serviceType: "ClusterIP",
    });
    const deployment = makeNode("starter-deployment", "Deployment", "nginx", ns, {
      replicas: 2,
      image: "nginx:1.27-alpine",
      containerPort: 80,
    });
    const config = makeNode("starter-configmap", "ConfigMap", "nginx-config", ns, {
      configData: "LOG_LEVEL=info\nWORKERS=4",
    });

    get().setGraph(
      [ingress, service, deployment, config],
      [makeEdge(ingress, service), makeEdge(service, deployment), makeEdge(config, deployment)],
      "Nginx Starter Workflow"
    );
  },
}));
