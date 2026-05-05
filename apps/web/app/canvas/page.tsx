"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactFlow, { Background, Controls, NodeTypes, ReactFlowInstance, BackgroundVariant, Panel, Connection } from "reactflow";
import "reactflow/dist/style.css";
import { useCanvasStore } from "../../store/canvasStore";
import K8sNode from "../../components/K8sNode";
import ResourceToolbox from "../../components/ResourceToolbox";
import HelmDashboard from "../../components/HelmDashboard";
import HelmReleaseManager from "../../components/HelmReleaseManager";
import WorkflowManager from "../../components/WorkflowManager";
import KeyboardShortcuts from "../../components/KeyboardShortcuts";
import DevModeIndicator from "../../components/DevModeIndicator";
import PodMetricsPanel from "../../components/PodMetricsPanel";
import ApiConnectionError from "../../components/ApiConnectionError";
import { Loader2, Play, Save, RefreshCw, AlertCircle, CheckCircle2, X } from "lucide-react";
import { compileGraph } from "../../lib/compiler";
import { API_URL } from "../../lib/api";
import { isValidConnection, getConnectionType } from "../../lib/edges";
import { RESOURCE_COLORS, DEFAULT_RESOURCE_COLOR, VALID_CONNECTIONS } from "../../lib/constants";

const nodeTypes: NodeTypes = {
  k8sNode: K8sNode,
};

function CanvasPageContent() {
  const { 
    nodes, 
    edges, 
    activeNamespace,
    namespaces,
    graphName,
    setGraphName,
    setActiveNamespace,
    loading, 
    error, 
    selectedNodeId,
    loadGraph,
    hydrateGraph,
    onNodesChange,
    onEdgesChange,
    addNode,
    deleteNode,
    saveGraph,
    clearCanvas,
    undo,
    redo,
  } = useCanvasStore();

  const searchParams = useSearchParams();
  const graphIdToLoad = searchParams.get("id");

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [showWorkflowManager, setShowWorkflowManager] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyState, setApplyState] = useState<"idle" | "dry-running" | "applying" | "success" | "error">("idle");
  const [errors, setErrors] = useState<{ resource: string; message: string }[]>([]);
  const [selectedPod, setSelectedPod] = useState<{ name: string; namespace: string } | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Track unsaved changes
  useEffect(() => {
    if (nodes.length > 0 || edges.length > 0) {
      setHasUnsavedChanges(true);
    }
  }, [nodes, edges]);

  useEffect(() => {
    if (graphIdToLoad) {
      loadGraph(graphIdToLoad);
    } else if (nodes.length === 0 && !sessionStorage.getItem('workflow_initialized')) {
      // Show workflow manager only on first load
      setShowWorkflowManager(true);
      sessionStorage.setItem('workflow_initialized', 'true');
    }
  }, [graphIdToLoad, loadGraph]);

  const handleLoadWorkflow = (type: 'new' | 'example' | 'cluster' | 'saved', id?: string) => {
    setShowWorkflowManager(false);
    setHasUnsavedChanges(false);
    
    if (type === 'new') {
      clearCanvas();
    } else if (type === 'example') {
      useCanvasStore.getState().createStarterWorkflow();
      setHasUnsavedChanges(true);
    } else if (type === 'cluster') {
      hydrateGraph();
      setHasUnsavedChanges(true);
    } else if (type === 'saved' && id) {
      // Already loaded by WorkflowManager
      setHasUnsavedChanges(false);
    }
  };

  const filteredNodes = useMemo(() => {
    if (activeNamespace === "all") return nodes;
    return nodes.filter(n => n.data.namespace === activeNamespace);
  }, [nodes, activeNamespace]);

  const filteredEdges = useMemo(() => {
    const nodeIds = new Set(filteredNodes.map(n => n.id));
    return edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  }, [edges, filteredNodes]);

  // ComfyUI-style typed connection validation
  const handleConnect = useCallback((connection: Connection) => {
    const sourceNode = nodes.find(n => n.id === connection.source);
    const targetNode = nodes.find(n => n.id === connection.target);
    
    if (!sourceNode || !targetNode) return;
    
    const sourceKind = sourceNode.data.kind;
    const targetKind = targetNode.data.kind;
    
    if (!isValidConnection(sourceKind, targetKind)) {
      const validTargets = VALID_CONNECTIONS[sourceKind] || [];
      showToast(`Cannot connect ${sourceKind} to ${targetKind}. Valid: ${validTargets.join(', ')}`, 'warning');
      return;
    }
    
    // Validate handle types match (ComfyUI-style)
    const sourceHandleType = connection.sourceHandle?.replace('output-', '');
    const targetHandleType = connection.targetHandle?.replace('input-', '');
    
    if (sourceHandleType && targetHandleType && sourceHandleType !== targetHandleType) {
      showToast(`Connection type mismatch: ${sourceHandleType} → ${targetHandleType}`, 'warning');
      return;
    }
    
    const connType = getConnectionType(sourceKind, targetKind);
    const isAnimated = connType.type === 'network' || connType.type === 'routing';
    
    useCanvasStore.getState().onConnect(connection);
    
    // Update the edge style after creation
    setTimeout(() => {
      const edges = useCanvasStore.getState().edges;
      const newEdge = edges[edges.length - 1];
      if (newEdge) {
        useCanvasStore.setState({
          edges: edges.map((e, idx) => 
            idx === edges.length - 1 
              ? { ...e, animated: isAnimated, style: { stroke: connType.color, strokeWidth: 2 } }
              : e
          )
        });
      }
    }, 0);
  }, [nodes]);

  const handleRefreshWorkflow = useCallback(() => {
    // If we have nodes from cluster (not manually created), refresh them
    const hasClusterNodes = nodes.some(n => n.data.uid && n.data.uid.length > 20);
    
    if (hasClusterNodes) {
      // Reload from cluster
      hydrateGraph();
    } else if (nodes.length > 0) {
      // If it's a manually created workflow, just keep it as is
      console.log('Manual workflow - no refresh needed');
    } else {
      // Empty canvas, do nothing
      console.log('Empty canvas - nothing to refresh');
    }
  }, [nodes, hydrateGraph]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedNodeId) {
      deleteNode(selectedNodeId);
    }
  }, [selectedNodeId, deleteNode]);

  const handleApply = async () => {
    setApplying(true);
    setErrors([]);
    setApplyState("dry-running");

    try {
      const k8sNodes = nodes.filter(n => n.data.kind !== "HelmRelease");
      const helmNodes = nodes.filter(n => n.data.kind === "HelmRelease");

      let yaml = "";
      if (k8sNodes.length > 0) {
        yaml = await compileGraph(k8sNodes, edges);
        if (!yaml && helmNodes.length === 0) {
          throw new Error("Graph compilation resulted in empty YAML.");
        }
      }

      // Dry Run
      if (yaml) {
        const dryRes = await fetch(`${API_URL}/api/graph/apply?dryRun=true`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ yaml }),
        });

        if (!dryRes.ok) {
          const dryData = await dryRes.json();
          setErrors(dryData.errors || [{ resource: "Unknown", message: dryData.error || "Dry-run failed" }]);
          setApplyState("error");
          setApplying(false);
          return;
        }
      }

      setApplyState("applying");

      // Apply K8s Resources
      if (yaml) {
        const applyRes = await fetch(`${API_URL}/api/graph/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ yaml }),
        });

        if (!applyRes.ok) {
          const applyData = await applyRes.json();
          setErrors(applyData.errors || [{ resource: "Unknown", message: applyData.error || "Apply failed" }]);
          setApplyState("error");
          setApplying(false);
          return;
        }
      }

      // Install Helm Charts
      const helmErrors: any[] = [];
      for (const hNode of helmNodes) {
        const chartName = hNode.data.chart?.repository && hNode.data.chart?.name
          ? `${hNode.data.chart.repository}/${hNode.data.chart.name}`
          : hNode.data.chart?.name || "unknown";
          
        const installRes = await fetch(`${API_URL}/api/helm/install`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            releaseName: hNode.data.name,
            chartName: chartName,
            namespace: hNode.data.namespace || "default",
            valuesYaml: hNode.data.valuesYaml || ""
          }),
        });
        if (!installRes.ok) {
          const installData = await installRes.json();
          helmErrors.push({ resource: hNode.data.name, message: installData.error || "Helm Install failed" });
        }
      }

      if (helmErrors.length > 0) {
        setErrors(helmErrors);
        setApplyState("error");
      } else {
        setApplyState("success");
        setTimeout(() => setApplyState("idle"), 3000);
      }
    } catch (err: any) {
      setErrors([{ resource: "Client", message: err.message }]);
      setApplyState("error");
    } finally {
      setApplying(false);
    }
  };

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();

    const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
    const type = event.dataTransfer.getData("application/reactflow");
    const kind = event.dataTransfer.getData("application/k8sKind");

    if (!type || !reactFlowInstance || !reactFlowBounds) {
      return;
    }

    const position = reactFlowInstance.project({
      x: event.clientX - reactFlowBounds.left,
      y: event.clientY - reactFlowBounds.top,
    });

    // Handle Helm chart drops
    let chartData = null;
    const helmStr = event.dataTransfer.getData("application/helmChart");
    if (helmStr) {
      try {
        chartData = JSON.parse(helmStr);
      } catch (e) {
        console.error("Failed to parse helm chart data", e);
      }
    }

    // For Helm charts, use the chart name and include full chart info
    const newNodeName = chartData 
      ? chartData.name 
      : `${kind.toLowerCase()}-${Math.random().toString(36).substring(2, 7)}`;

    const newNode = {
      id: `${kind}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      type,
      position,
      data: {
        kind,
        name: newNodeName,
        namespace: activeNamespace === "all" ? "default" : activeNamespace,
        status: chartData ? "Ready to Install" : "Pending",
        color: RESOURCE_COLORS[kind] || DEFAULT_RESOURCE_COLOR,
        // Helm-specific data
        ...(chartData && {
          chart: {
            name: chartData.name,
            description: chartData.description,
            repository: chartData.repository?.name || "unknown",
            repositoryUrl: chartData.repository?.url || "",
          },
          valuesYaml: "", // User can edit this in the node
        }),
        // K8s resource defaults
        replicas: 1,
        image: "",
        port: 80,
      },
    };

    addNode(newNode);
  }, [reactFlowInstance, activeNamespace, addNode]);

  if (loading && nodes.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-neutral-950">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
        <p className="text-gray-600 dark:text-gray-400 font-medium">Loading cluster graph...</p>
      </div>
    );
  }

  if (error && nodes.length === 0) {
    // Check if it's an API connection error
    if (error.includes('Cannot connect to API server')) {
      return <ApiConnectionError error={error} onRetry={hydrateGraph} />;
    }
    
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-neutral-950">
        <div className="bg-white dark:bg-neutral-900 border border-red-200 dark:border-red-900/50 rounded p-8 max-w-md">
          <h2 className="text-xl font-bold text-red-600 dark:text-red-400 mb-2">Connection Error</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-4">{error}</p>
          <button
            onClick={() => window.location.href = "/connect"}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition-colors"
          >
            Go to Connect Page
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="w-full h-screen relative bg-gray-50 dark:bg-neutral-950 overflow-hidden">
      {/* ComfyUI-style Top Menu Bar */}
      <div className="absolute top-0 left-0 right-0 h-12 bg-neutral-900 border-b border-neutral-800 z-40 flex items-center justify-between px-4">
        {/* Left: Logo and Workflow Name */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">
              <span className="text-white font-bold text-sm">k8n</span>
            </div>
            <input 
              type="text" 
              value={graphName}
              onChange={(e) => setGraphName(e.target.value)}
              className="text-sm font-medium bg-neutral-800 border border-neutral-700 focus:border-blue-500 rounded px-3 py-1 w-48 text-gray-100 placeholder-gray-500 outline-none"
              placeholder="Workflow name..."
            />
          </div>
        </div>

        {/* Center: Main Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowWorkflowManager(true)}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-sm font-medium text-gray-300 transition-colors flex items-center gap-2"
            title="Workflow Manager"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            Workflows
          </button>

          <button 
            onClick={async () => {
              await saveGraph();
              showToast('Workflow saved', 'success');
            }} 
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-sm font-medium text-gray-300 transition-colors flex items-center gap-2"
            title="Save Workflow (Ctrl+S)"
          >
            <Save className="w-4 h-4" />
            Save
          </button>

          <button
            onClick={handleRefreshWorkflow}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-sm font-medium text-gray-300 transition-colors flex items-center gap-2"
            title="Refresh from Cluster (Ctrl+R)"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>

          <button
            onClick={handleApply}
            disabled={applying || nodes.length === 0}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {applying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {applyState === "dry-running" ? "Validating..." : applyState === "applying" ? "Applying..." : "Apply to Cluster"}
          </button>

          {applyState === "success" && (
            <div className="flex items-center gap-1.5 text-green-400 px-2">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-xs font-medium">Applied!</span>
            </div>
          )}
        </div>

        {/* Right: Namespace, View Options, Help */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-800 border border-neutral-700 rounded">
            <span className="text-xs font-medium text-gray-400">Namespace:</span>
            <select 
              className="text-sm bg-transparent border-none text-gray-300 outline-none cursor-pointer"
              value={activeNamespace}
              onChange={(e) => setActiveNamespace(e.target.value)}
            >
              <option value="all">All</option>
              {namespaces.map(ns => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
            </select>
          </div>

          <Link
            href="/deployed"
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-sm font-medium text-gray-300 transition-colors flex items-center gap-2"
            title="View Deployed Resources"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Deployed
          </Link>

          <Link
            href="/help"
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-sm font-medium text-gray-300 transition-colors flex items-center gap-2"
            title="Help & Instructions"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Help
          </Link>
        </div>
      </div>

      <ResourceToolbox />
      <HelmDashboard />
      <HelmReleaseManager />
      <KeyboardShortcuts 
        onSave={async () => {
          await saveGraph();
          showToast('Workflow saved', 'success');
        }}
        onRefresh={handleRefreshWorkflow}
        onDelete={handleDeleteSelected}
        onUndo={undo}
        onRedo={redo}
      />
      <DevModeIndicator />

      {/* API / Cluster connection error banner */}
      {error && (
        <div className="absolute top-12 left-0 right-0 z-40 bg-red-950/90 border-b border-red-800 px-4 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span className="text-xs text-red-300 truncate">{error}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={hydrateGraph}
              className="flex items-center gap-1 px-2 py-1 bg-red-800 hover:bg-red-700 text-red-200 text-xs rounded transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
            <a
              href="/connect"
              className="flex items-center gap-1 px-2 py-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded transition-colors"
            >
              Connect to Cluster
            </a>
          </div>
        </div>
      )}

      {/* Pod Metrics Panel */}
      {selectedPod && (
        <PodMetricsPanel
          podName={selectedPod.name}
          namespace={selectedPod.namespace}
          onClose={() => setSelectedPod(null)}
        />
      )}

      {/* Workflow Manager */}
      <WorkflowManager 
        isOpen={showWorkflowManager}
        onClose={() => setShowWorkflowManager(false)}
        onLoadWorkflow={handleLoadWorkflow}
      />

      {/* Welcome Screen for empty canvas */}
      {!loading && nodes.length === 0 && !showWorkflowManager && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none" style={{ marginTop: '48px' }}>
          <div className="pointer-events-auto">
            <button
              onClick={() => setShowWorkflowManager(true)}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded transition-colors"
            >
              Open Workflow Manager
            </button>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-16 right-4 z-[100] px-4 py-3 rounded-lg shadow-xl backdrop-blur-md border flex items-center gap-2 animate-in slide-in-from-right transition-all ${
          toast.type === 'success' ? 'bg-green-950/90 border-green-800 text-green-200' :
          toast.type === 'error' ? 'bg-red-950/90 border-red-800 text-red-200' :
          'bg-yellow-950/90 border-yellow-800 text-yellow-200'
        }`}>
          {toast.type === 'success' && <CheckCircle2 className="w-4 h-4" />}
          {toast.type === 'error' && <AlertCircle className="w-4 h-4" />}
          {toast.type === 'warning' && <AlertCircle className="w-4 h-4" />}
          <span className="text-sm font-medium">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Error Panel */}
      {errors.length > 0 && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 w-[500px] max-h-80 overflow-y-auto bg-neutral-900 border-2 border-red-600 rounded-lg z-50 shadow-2xl">
          <div className="bg-red-950/50 px-4 py-2 border-b border-red-900/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <h4 className="text-sm font-semibold text-red-300">Apply Errors</h4>
            </div>
            <button 
              onClick={() => setErrors([])} 
              className="text-red-400 hover:text-red-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-3 space-y-2">
            {errors.map((e, i) => (
              <div key={i} className="bg-red-950/20 border border-red-900/30 rounded p-2">
                <div className="text-xs font-semibold text-red-300 mb-1">
                  Resource: {e.resource}
                </div>
                <div className="text-xs text-red-400 font-mono">
                  {e.message}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="w-full h-full pt-12" ref={reactFlowWrapper}>
        <ReactFlow 
          nodes={filteredNodes} 
          edges={filteredEdges} 
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={(event, node) => {
            // Set selected node for keyboard shortcuts (delete key)
            useCanvasStore.setState({ selectedNodeId: node.id });
            
            // If clicking on a Pod, show metrics panel
            if (node.data.kind === 'Pod') {
              setSelectedPod({
                name: node.data.name,
                namespace: node.data.namespace || 'default'
              });
            } else {
              setSelectedPod(null);
            }
          }}
          onPaneClick={() => {
            // Deselect when clicking on empty space
            useCanvasStore.setState({ selectedNodeId: null });
            setSelectedPod(null);
          }}
          fitView
          minZoom={0.1}
          maxZoom={2}
          defaultEdgeOptions={{
            animated: true,
            style: { stroke: '#3b82f6', strokeWidth: 2 },
          }}
        >
          <Background 
            gap={20} 
            size={1} 
            color="#e5e7eb" 
            variant={BackgroundVariant.Dots}
            className="dark:opacity-20"
          />
          <Controls 
            position="bottom-right"
            className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded shadow-sm"
          />
          {/* Bottom-left status info - ComfyUI style */}
          {nodes.length > 0 && (
            <Panel position="bottom-left" className="bg-neutral-900/90 backdrop-blur-sm border border-neutral-800 rounded px-3 py-2 text-xs text-gray-400">
              <div className="flex items-center gap-4 whitespace-nowrap">
                <span>{filteredNodes.length} {filteredNodes.length === 1 ? 'node' : 'nodes'}</span>
                <span>•</span>
                <span>{filteredEdges.length} {filteredEdges.length === 1 ? 'connection' : 'connections'}</span>
                <span>•</span>
                <span className="text-blue-400">{activeNamespace === 'all' ? 'All Namespaces' : activeNamespace}</span>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </div>
  );
}

export default function CanvasPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-neutral-950">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
      </div>
    }>
      <CanvasPageContent />
    </Suspense>
  );
}
