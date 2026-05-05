import { create } from "zustand";
import { Node, Edge, Connection, addEdge, applyNodeChanges, applyEdgeChanges, NodeChange, EdgeChange } from "reactflow";
import { fetchResources, API_URL } from "../lib/api";
import { generateEdges } from "../lib/edges";
import { layoutGraph } from "../lib/layout";
import { RESOURCE_COLORS, DEFAULT_RESOURCE_COLOR } from "../lib/constants";

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
  history: { nodes: Node[]; edges: Edge[] }[];
  historyIndex: number;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  hydrateGraph: () => Promise<void>;
  setActiveNamespace: (ns: string) => void;
  setGraphName: (name: string) => void;
  setSelectedNodeId: (id: string | null) => void;
  updateNodeData: (nodeId: string, data: any) => void;
  addNode: (node: Node) => void;
  deleteNode: (nodeId: string) => void;
  saveGraph: () => Promise<void>;
  loadGraph: (id: string) => Promise<void>;
  createStarterWorkflow: () => void;
  clearCanvas: () => void;
  undo: () => void;
  redo: () => void;
  saveHistory: () => void;
}



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
  history: [],
  historyIndex: -1,
  
  saveHistory: () => {
    const { nodes, edges, history, historyIndex } = get();
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
    // Keep only last 50 states
    if (newHistory.length > 50) {
      newHistory.shift();
    }
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex > 0) {
      const prevState = history[historyIndex - 1];
      set({
        nodes: JSON.parse(JSON.stringify(prevState.nodes)),
        edges: JSON.parse(JSON.stringify(prevState.edges)),
        historyIndex: historyIndex - 1,
      });
    }
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      const nextState = history[historyIndex + 1];
      set({
        nodes: JSON.parse(JSON.stringify(nextState.nodes)),
        edges: JSON.parse(JSON.stringify(nextState.edges)),
        historyIndex: historyIndex + 1,
      });
    }
  },

  clearCanvas: () => {
    set({
      nodes: [],
      edges: [],
      graphName: 'Untitled Graph',
      graphId: null,
      selectedNodeId: null,
      history: [],
      historyIndex: -1,
    });
  },
  
  setGraphName: (name: string) => set({ graphName: name }),
  
  setSelectedNodeId: (id: string | null) => set({ selectedNodeId: id }),

  onNodesChange: (changes: NodeChange[]) => {
    // Only save history for structural changes, NOT position drags (which fire 60x/sec)
    const hasStructuralChange = changes.some(c => c.type === 'remove' || c.type === 'add' || c.type === 'reset');
    if (hasStructuralChange) {
      get().saveHistory();
    }

    set({ nodes: applyNodeChanges(changes, get().nodes) });
    
    // Handle selection changes
    const selectChange = changes.find(c => c.type === 'select');
    if (selectChange && 'selected' in selectChange) {
      if (selectChange.selected) {
        set({ selectedNodeId: selectChange.id });
      } else if (get().selectedNodeId === selectChange.id) {
        set({ selectedNodeId: null });
      }
    }
    
    // Handle node removal
    const removeChange = changes.find(c => c.type === 'remove');
    if (removeChange && get().selectedNodeId === removeChange.id) {
      set({ selectedNodeId: null });
    }
  },
  
  onEdgesChange: (changes: EdgeChange[]) => {
    const hasStructuralChange = changes.some(c => c.type === 'remove' || c.type === 'add' || c.type === 'reset');
    if (hasStructuralChange) {
      get().saveHistory();
    }
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },
  
  onConnect: (connection: Connection) => {
    get().saveHistory();
    set({ edges: addEdge({ ...connection, animated: true }, get().edges) });
  },

  updateNodeData: (nodeId: string, data: any) => {
    get().saveHistory();
    set({
      nodes: get().nodes.map(node =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...data } }
          : node
      ),
    });
  },

  addNode: (node: Node) => {
    get().saveHistory();
    set({ nodes: [...get().nodes, node] });
  },

  deleteNode: (nodeId: string) => {
    get().saveHistory();
    set({
      nodes: get().nodes.filter(n => n.id !== nodeId),
      edges: get().edges.filter(e => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
    });
  },

  hydrateGraph: async () => {
    try {
      set({ loading: true, error: null });
      const resources = await fetchResources();
      
      // Filter out noise - only show important resources
      const importantKinds = new Set([
        'Deployment', 'StatefulSet', 'DaemonSet', 
        'Service', 'Ingress',
        'ConfigMap', 'Secret',
        'Job', 'CronJob',
        'PersistentVolumeClaim'
      ]);
      
      // Filter out system namespaces and unimportant resources
      const filteredResources = resources.filter(r => {
        // Skip system namespaces
        if (['kube-system', 'kube-public', 'kube-node-lease'].includes(r.namespace)) {
          return false;
        }
        
        // Only include important resource types
        if (!importantKinds.has(r.kind)) {
          return false;
        }
        
        return true;
      });
      
      const uniqueNamespaces = Array.from(new Set(filteredResources.map(r => r.namespace).filter(Boolean)));
      
      const nodes: Node[] = filteredResources.map(r => ({
        id: r.uid,
        type: "k8sNode",
        position: { x: 0, y: 0 },
        data: {
          ...r,
          color: RESOURCE_COLORS[r.kind] || DEFAULT_RESOURCE_COLOR
        }
      }));

      const edges = generateEdges(filteredResources);
      const layoutedNodes = layoutGraph(nodes, edges);

      set({ 
        nodes: layoutedNodes, 
        edges, 
        namespaces: uniqueNamespaces,
        loading: false 
      });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  setActiveNamespace: (ns: string) => {
    set({ activeNamespace: ns });
  },

  saveGraph: async () => {
    try {
      const state = get();
      set({ loading: true, error: null });
      const res = await fetch(`${API_URL}/api/graph/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: state.graphId,
          name: state.graphName,
          namespace: state.activeNamespace,
          graph_json: { nodes: state.nodes, edges: state.edges }
        })
      });
      if (!res.ok) throw new Error("Failed to save graph");
      const data = await res.json();
      set({ graphId: data.id, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  loadGraph: async (id: string) => {
    try {
      set({ loading: true, error: null });
      const res = await fetch(`${API_URL}/api/graph/${id}`);
      if (!res.ok) throw new Error("Failed to load graph");
      const data = await res.json();
      set({
        graphId: data.id,
        graphName: data.name,
        activeNamespace: data.namespace,
        nodes: data.graph_json?.nodes || [],
        edges: data.graph_json?.edges || [],
        loading: false
      });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  createStarterWorkflow: () => {
    const deploymentNode: Node = {
      id: 'starter-deployment',
      type: 'k8sNode',
      position: { x: 100, y: 100 },
      data: {
        kind: 'Deployment',
        name: 'nginx-deployment',
        namespace: 'default',
        status: 'Pending',
        color: RESOURCE_COLORS.Deployment,
        replicas: 3,
        image: 'nginx:latest',
      }
    };

    const serviceNode: Node = {
      id: 'starter-service',
      type: 'k8sNode',
      position: { x: 450, y: 100 },
      data: {
        kind: 'Service',
        name: 'nginx-service',
        namespace: 'default',
        status: 'Pending',
        color: RESOURCE_COLORS.Service,
        port: 80,
      }
    };

    const configMapNode: Node = {
      id: 'starter-configmap',
      type: 'k8sNode',
      position: { x: 100, y: 250 },
      data: {
        kind: 'ConfigMap',
        name: 'nginx-config',
        namespace: 'default',
        status: 'Pending',
        color: RESOURCE_COLORS.ConfigMap,
      }
    };

    const edge: Edge = {
      id: 'starter-edge',
      source: 'starter-service',
      target: 'starter-deployment',
      animated: true,
    };

    set({
      nodes: [deploymentNode, serviceNode, configMapNode],
      edges: [edge],
      graphName: 'Nginx Starter Workflow',
    });
  },
}));
