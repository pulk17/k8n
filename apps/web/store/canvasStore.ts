import { create } from "zustand";
import {
  Node, Edge, Connection, addEdge, applyNodeChanges, applyEdgeChanges,
  NodeChange, EdgeChange,
} from "reactflow";
import { fetchResources, fetchNamespaces, errorMessage, ImportedGraph, K8sResource } from "../lib/api";
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

// Typing into a field calls updateNodeData once per keystroke. Pushing a history
// entry for each one made Ctrl+Z walk back a character at a time, and a
// 16-character name evicted a third of the buffer — so the structural change you
// actually wanted to undo was already gone. Successive edits to the same node
// inside this window count as one entry, which is the same reasoning
// onNodesChange already applies to drag frames.
const EDIT_COALESCE_MS = 600;
let lastEdit = { id: "", at: 0 };

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
  /** Whether the right-hand dock is open. Selecting a node no longer opens it:
      the card itself expands for the common edits, and this is for the rest. */
  inspectorOpen: boolean;
  /** No engine to talk to: the canvas works, the cluster half does not. This is
      what a hosted copy of the page looks like before you run k8n locally. */
  offline: boolean;
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
  setInspectorOpen: (open: boolean) => void;
  setOffline: (offline: boolean) => void;
  /** Opens the dock on a node in one step, for the card's own button. */
  inspectNode: (id: string) => void;
  /** Selects one node and deselects the rest, the way clicking it would. */
  selectOnly: (id: string) => void;
  setShowPods: (show: boolean) => void;
  setShowSystemNamespaces: (show: boolean) => void;
  updateNodeData: (nodeId: string, data: Partial<NodeData>) => void;
  /** Refreshes the status of imported nodes from the watch stream, in place. */
  applyLiveStatus: (resources: K8sResource[]) => void;
  addNode: (node: Node) => void;
  deleteNode: (nodeId: string) => void;
  /** Puts the resources a chart renders on the canvas, beside their release. */
  addChartNodes: (releaseId: string, imported: ImportedGraph) => number;
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
  inspectorOpen: false,
  offline: false,
  dirty: false,
  showPods: false,
  showSystemNamespaces: false,
  history: [],
  historyIndex: -1,

  canUndo: () => get().historyIndex >= 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  saveHistory: () => {
    const { nodes, edges, history, historyIndex } = get();
    const next = history.slice(0, historyIndex + 1);
    next.push({ nodes: clone(nodes), edges: clone(edges) });
    if (next.length > MAX_HISTORY) next.shift();
    set({ history: next, historyIndex: next.length - 1, dirty: true });
  },

  undo: () => {
    const { nodes, edges, history, historyIndex } = get();
    if (historyIndex < 0) return;
    // Forget the edit burst, or typing into the same node right after an undo
    // would coalesce into it and lose the state we just restored.
    lastEdit = { id: "", at: 0 };
    const nextHistory = [...history];
    const snapshot = history[historyIndex];
    nextHistory[historyIndex] = { nodes: clone(nodes), edges: clone(edges) };
    set({
      nodes: clone(snapshot.nodes),
      edges: clone(snapshot.edges),
      history: nextHistory,
      historyIndex: historyIndex - 1,
      dirty: true,
    });
  },

  redo: () => {
    const { nodes, edges, history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;
    lastEdit = { id: "", at: 0 };
    const nextIndex = historyIndex + 1;
    const snapshot = history[nextIndex];
    const nextHistory = [...history];
    nextHistory[nextIndex] = { nodes: clone(nodes), edges: clone(edges) };
    set({
      nodes: clone(snapshot.nodes),
      edges: clone(snapshot.edges),
      history: nextHistory,
      historyIndex: nextIndex,
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

  setInspectorOpen: open => set({ inspectorOpen: open }),

  // Going offline clears the error with it: the canvas is about to work, and a
  // red banner about an unreachable API would be describing a decision the user
  // already made.
  setOffline: offline => set({ offline, error: null }),

  inspectNode: id => set({ selectedNodeId: id, inspectorOpen: true }),

  // React Flow draws the highlight from `selected` on the node itself, not from
  // our selectedNodeId — so anything that selects a node without going through
  // a click (the tour, a failed check) has to say so here too, or it points at
  // a card that looks exactly like every other card.
  selectOnly: id => {
    const nodes = get().nodes;
    // Only write a new array when the selection actually moves. Handing out a
    // fresh array every time makes anything deriving from `nodes` recompute,
    // and a caller that re-selects in response to that derivation spins.
    if (!nodes.some(node => node.selected !== (node.id === id))) {
      set({ selectedNodeId: id });
      return;
    }
    set({
      selectedNodeId: id,
      nodes: nodes.map(node =>
        node.selected === (node.id === id) ? node : { ...node, selected: node.id === id }
      ),
    });
  },
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
    const now = Date.now();
    if (id !== lastEdit.id || now - lastEdit.at >= EDIT_COALESCE_MS) get().saveHistory();
    lastEdit = { id, at: now };

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
    // Chart-rendered nodes have no cluster identity until the release is
    // installed, so they are matched on what the chart named them instead.
    // This is what makes a failed install visible where you drew it: the
    // rendered cards pick up ImagePullBackOff like any other resource.
    const byIdentity = new Map(resources.map(r => [`${r.kind}/${r.namespace}/${r.name}`, r]));
    let moved = false;

    const nodes = get().nodes.map(node => {
      const origin = node.data?.origin;
      if (origin !== "cluster" && origin !== "helm") return node;

      const live =
        origin === "cluster"
          ? byUid.get(node.id)
          : byIdentity.get(`${node.data.kind}/${node.data.namespace}/${node.data.name}`);

      // An uninstalled chart is not a deleted resource — it was never there.
      if (!live && origin === "helm") {
        return node.data.status === "From chart"
          ? node
          : ((moved = true),
            { ...node, data: { ...node.data, status: "From chart", statusMessage: undefined } });
      }

      const status = live ? live.status : "Deleted";
      const statusMessage = live ? live.statusMessage : "No longer in the cluster";
      const readyReplicas = live ? live.readyReplicas : node.data.readyReplicas;
      const startup = live?.startup;

      if (
        node.data.status === status &&
        node.data.statusMessage === statusMessage &&
        node.data.readyReplicas === readyReplicas &&
        node.data.startup?.step === startup?.step &&
        node.data.startup?.since === startup?.since
      ) {
        return node;
      }

      moved = true;
      return { ...node, data: { ...node.data, status, statusMessage, readyReplicas, startup } };
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
    // A release takes its rendered resources with it: they only ever existed to
    // show what that chart installs, so leaving them behind would strand a
    // handful of cards nothing on the canvas explains.
    const gone = new Set([id]);
    for (const node of get().nodes) {
      if (node.data?.chartOf === id) gone.add(node.id);
    }
    set({
      nodes: get().nodes.filter(n => !gone.has(n.id)),
      edges: get().edges.filter(e => !gone.has(e.source) && !gone.has(e.target)),
      selectedNodeId: gone.has(get().selectedNodeId || "") ? null : get().selectedNodeId,
    });
  },

  /**
   * Draws the objects a chart renders next to the release that installs them.
   *
   * They are marked `origin: "helm"`, which keeps them out of the compiler —
   * Helm creates these, and applying them as plain YAML too would make every
   * one of them twice, owned by two different things. They are here to be read.
   */
  addChartNodes: (releaseId, imported) => {
    const release = get().nodes.find(n => n.id === releaseId);
    if (!release) return 0;

    get().saveHistory();

    // Re-rendering replaces whatever the last render drew, rather than
    // stacking a second copy of every object on top of the first.
    const stale = new Set(get().nodes.filter(n => n.data?.chartOf === releaseId).map(n => n.id));
    const nodes = get().nodes.filter(n => !stale.has(n.id));
    const edges = get().edges.filter(e => !stale.has(e.source) && !stale.has(e.target));

    const byImportId = new Map<string, Node>();
    const drawn: Node[] = [];
    for (const spec of imported.nodes) {
      const node = makeNode(nodeId(spec.kind), spec.kind, spec.name, spec.namespace, spec.fields);
      node.data.origin = "helm";
      node.data.chartOf = releaseId;
      node.data.status = "From chart";
      byImportId.set(spec.id, node);
      drawn.push(node);
      nodes.push(node);
    }

    // The release owns everything it renders; the rest are the references the
    // importer found between the objects themselves (a Service's selector, a
    // mounted volume). Both go through the same connection rules as hand-drawn
    // wires, so a pair the canvas has no relationship for simply gets none.
    const connect = (source: Node, target: Node) => {
      if (!isValidConnection(source.data.kind, target.data.kind)) return;
      if (edges.some(e => e.source === source.id && e.target === target.id)) return;
      edges.push(makeEdge(source, target));
    };
    const drawnEdges: Edge[] = [];
    const before = edges.length;
    for (const node of drawn) connect(release, node);
    for (const edge of imported.edges) {
      const source = byImportId.get(edge.source);
      const target = byImportId.get(edge.target);
      if (source && target) connect(source, target);
    }
    drawnEdges.push(...edges.slice(before));

    // Laid out as its own graph, then moved to sit beside the release. Twenty
    // objects dropped into a grid is a ball of crossing wires; dagre gives the
    // same objects the shape the chart actually has. The release keeps the
    // position the user dropped it at, and nothing else on the canvas moves.
    const positioned = layoutGraph([release, ...drawn], drawnEdges);
    const anchor = positioned.find(n => n.id === release.id);
    const dx = anchor ? release.position.x - anchor.position.x : 0;
    const dy = anchor ? release.position.y - anchor.position.y : 0;
    const placed = new Map(
      positioned
        .filter(n => n.id !== release.id)
        .map(n => [n.id, { x: n.position.x + dx, y: n.position.y + dy }])
    );
    for (const node of drawn) {
      const at = placed.get(node.id);
      if (at) node.position = at;
    }

    set({ nodes, edges, dirty: true });
    return drawn.length;
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
