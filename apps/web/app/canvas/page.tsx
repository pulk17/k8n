"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  NodeTypes,
  Panel,
  ReactFlowInstance,
  getRectOfNodes,
  getTransformForBounds,
} from "reactflow";
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
import { AlertCircle, CheckCircle2, Eye, FolderOpen, HelpCircle, Loader2, Play, RefreshCw, Save, X, FileCode } from "lucide-react";
import { ApiError, CompileResult, applyYaml, compileGraph, errorMessage, installHelmChart, watchResources } from "../../lib/api";
import { isValidConnection, validTargetsFor } from "../../lib/connections";
import { defaultsForKind } from "../../lib/nodeSchema";
import { makeNode, nodeId } from "../../lib/graph";
import { notify, notifyError } from "../../lib/dialog";
import YamlPreview from "../../components/YamlPreview";
import AIPanel from "../../components/AIPanel";

const nodeTypes: NodeTypes = {
  k8sNode: K8sNode,
};

type ApplyState = "idle" | "dry-running" | "applying" | "success" | "error";

// The resource toolbox floats over the left edge of the canvas, so fitView —
// which centres in the full viewport — used to tuck the leftmost nodes
// underneath it. Everything is nudged right by half that width instead.
const TOOLBOX_WIDTH = 292;

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
    dirty,
    loadGraph,
    hydrateGraph,
    loadNamespaces,
    onNodesChange,
    onEdgesChange,
    onConnect,
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
  const draggingFrom = useRef<string | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [showWorkflowManager, setShowWorkflowManager] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [compiled, setCompiled] = useState<CompileResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [applyState, setApplyState] = useState<ApplyState>("idle");
  const [errors, setErrors] = useState<{ resource: string; message: string }[]>([]);
  const [selectedPod, setSelectedPod] = useState<{ name: string; namespace: string } | null>(null);

  const applying = applyState === "dry-running" || applyState === "applying";

  // Warn before losing unsaved work. `dirty` used to be tracked and never read.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // The compiled preview goes stale the moment the graph changes.
  useEffect(() => {
    setCompiled(null);
    setShowPreview(false);
  }, [nodes, edges]);

  useEffect(() => {
    loadNamespaces();
  }, [loadNamespaces]);

  // Imported nodes track the cluster, so their status dots move on their own.
  // A hand-drawn graph has nothing live to follow, so it opens no stream.
  const trackingCluster = nodes.some((n) => n.data?.origin === "cluster");
  useEffect(() => {
    if (!trackingCluster) return;
    return watchResources(
      undefined,
      (resources) => useCanvasStore.getState().applyLiveStatus(resources),
      // Losing the stream leaves the last known status on screen; the canvas
      // itself keeps working, so there is nothing worth interrupting for.
      () => {}
    );
  }, [trackingCluster]);

  // Runs once per session: either open the requested workflow, or offer the
  // manager so the canvas is never just an empty grid on a first visit.
  useEffect(() => {
    if (graphIdToLoad) {
      loadGraph(graphIdToLoad);
      return;
    }
    if (!sessionStorage.getItem("workflow_opened")) {
      sessionStorage.setItem("workflow_opened", "true");
      setShowWorkflowManager(true);
    }
  }, [graphIdToLoad, loadGraph]);

  const handleLoadWorkflow = (type: "new" | "example" | "cluster" | "saved") => {
    setShowWorkflowManager(false);

    if (type === 'new') {
      clearCanvas();
    } else if (type === 'example') {
      useCanvasStore.getState().createStarterWorkflow();
    } else if (type === 'cluster') {
      hydrateGraph();
    }
    // 'saved' is already loaded by WorkflowManager.
  };

  const filteredNodes = useMemo(() => {
    if (activeNamespace === "all") return nodes;
    return nodes.filter(n => n.data.namespace === activeNamespace);
  }, [nodes, activeNamespace]);

  const filteredEdges = useMemo(() => {
    const nodeIds = new Set(filteredNodes.map(n => n.id));
    return edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  }, [edges, filteredNodes]);

  /**
   * Rejects a connection while it is still being dragged, so the line simply
   * refuses to snap instead of being accepted and then undone with an error.
   * Both ends must agree on the connection type, which is what makes a coloured
   * socket mean something.
   */
  const canConnect = useCallback((connection: Connection) => {
    const source = nodes.find(n => n.id === connection.source);
    const target = nodes.find(n => n.id === connection.target);
    if (!source || !target || source.id === target.id) return false;
    if (!isValidConnection(source.data.kind, target.data.kind)) return false;

    const from = connection.sourceHandle?.replace("output-", "");
    const to = connection.targetHandle?.replace("input-", "");
    return !from || !to || from === to;
  }, [nodes]);

  // Explains the refusal, since a line that will not snap says nothing about
  // why. Fires on the drop, after canConnect has already blocked the edge.
  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    const el = (event.target as HTMLElement)?.closest?.(".react-flow__node");
    const targetId = el?.getAttribute("data-id");
    const source = nodes.find(n => n.id === draggingFrom.current);
    const target = nodes.find(n => n.id === targetId);
    if (!source || !target || source.id === target.id) return;
    if (isValidConnection(source.data.kind, target.data.kind)) return;

    const allowed = validTargetsFor(source.data.kind);
    notifyError(
      allowed.length
        ? `${source.data.kind} does not connect to ${target.data.kind}. It connects to: ${allowed.join(", ")}.`
        : `${source.data.kind} has no outgoing connections.`
    );
  }, [nodes]);

  const handleRefreshWorkflow = useCallback(() => {
    if (nodes.some(n => n.data.origin === 'cluster')) {
      hydrateGraph();
    } else {
      notify("This workflow was built on the canvas — nothing to refresh from the cluster.");
    }
  }, [nodes, hydrateGraph]);

  /**
   * Frames the graph in the part of the canvas the toolbox is not covering.
   * fitView on its own centres in the full viewport, which tucked the leftmost
   * nodes underneath the toolbox, so the fit is computed against the visible
   * width and then shifted back past it.
   */
  const frameGraph = useCallback(() => {
    const flow = reactFlowInstance;
    const container = reactFlowWrapper.current;
    if (!flow || !container) return;

    // Node sizes are only known once React Flow has measured them, and a fresh
    // graph is not measured in the same tick it is set. Without waiting, the
    // bounds come out short and the rightmost node ends up off-screen.
    const current = flow.getNodes();
    if (current.length === 0 || current.some(n => !n.width || !n.height)) {
      requestAnimationFrame(frameGraph);
      return;
    }

    const visibleWidth = container.clientWidth - TOOLBOX_WIDTH;
    if (visibleWidth < 200) return;

    const [x, y, zoom] = getTransformForBounds(
      getRectOfNodes(current),
      visibleWidth,
      container.clientHeight,
      0.2,
      1.5,
      0.12
    );
    flow.setViewport({ x: x + TOOLBOX_WIDTH, y, zoom }, { duration: 200 });
  }, [reactFlowInstance]);

  // Reframe when the graph is replaced wholesale, not on every edit.
  useEffect(() => {
    frameGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphName, reactFlowInstance]);

  const handleSave = useCallback(async () => {
    try {
      const source = await saveGraph();
      notify(
        source === "database" ? "Saved to the database" : "Saved in this browser (no database)",
        "success"
      );
    } catch (err) {
      notifyError(`Could not save: ${errorMessage(err)}`);
    }
  }, [saveGraph]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedNodeId) {
      deleteNode(selectedNodeId);
    }
  }, [selectedNodeId, deleteNode]);

  /** Compiles the graph and opens the preview; nothing reaches the cluster yet. */
  const handlePreview = useCallback(async () => {
    setErrors([]);
    setCompiling(true);
    try {
      const result = await compileGraph(nodes, edges);
      setCompiled(result);
      setShowPreview(true);
      if (result.objects === 0 && !nodes.some(n => n.data.kind === "HelmRelease")) {
        notify("Nothing to apply — the graph compiled to no resources.");
      }
    } catch (err) {
      setErrors([{ resource: "Compile", message: errorMessage(err) }]);
    } finally {
      setCompiling(false);
    }
  }, [nodes, edges]);

  /** Dry-runs, then applies, the YAML the user just reviewed. */
  const handleApply = useCallback(async () => {
    const yaml = compiled?.yaml || "";
    setErrors([]);
    setApplyState("dry-running");

    try {
      if (yaml) {
        // The dry run is the point of the preview: the API server validates the
        // whole manifest before anything is written.
        await applyYaml(yaml, true);
        setApplyState("applying");
        await applyYaml(yaml, false);
      }

      // Charts are installed as Helm releases, never as the plain YAML in the
      // preview — applying both would create every resource twice, once owned
      // by k8n and once by Helm.
      const failures: { resource: string; message: string }[] = [];
      for (const node of nodes.filter(n => n.data.kind === "HelmRelease")) {
        const chart = node.data.chart;
        if (!chart?.name) {
          failures.push({ resource: node.data.name, message: "No chart selected on this node" });
          continue;
        }
        try {
          await installHelmChart({
            releaseName: node.data.name,
            chart: chart.name,
            repoUrl: chart.repositoryUrl,
            version: node.data.chartVersion || undefined,
            namespace: node.data.namespace || "default",
            valuesYaml: node.data.valuesYaml || "",
          });
        } catch (err) {
          failures.push({ resource: node.data.name, message: errorMessage(err) });
        }
      }

      if (failures.length > 0) {
        setErrors(failures);
        setApplyState("error");
        return;
      }

      setApplyState("success");
      setShowPreview(false);
      notify("Applied to cluster", "success");
      setTimeout(() => setApplyState("idle"), 3000);
    } catch (err) {
      // The apply handler reports per-resource failures in an `errors` array.
      const details = (err as ApiError)?.details;
      setErrors(
        Array.isArray(details) ? details : [{ resource: "Apply", message: errorMessage(err) }]
      );
      setApplyState("error");
    }
  }, [compiled, nodes]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();

    const bounds = reactFlowWrapper.current?.getBoundingClientRect();
    const type = event.dataTransfer.getData("application/reactflow");
    const kind = event.dataTransfer.getData("application/k8sKind");
    if (!type || !reactFlowInstance || !bounds) return;

    // Helm charts are dragged in from the Artifact Hub panel.
    let chart: { name: string; description: string; repository?: { name: string; url: string } } | null = null;
    const helmData = event.dataTransfer.getData("application/helmChart");
    if (helmData) {
      try {
        chart = JSON.parse(helmData);
      } catch {
        // A malformed payload just means "no chart"; the node is still useful.
      }
    }

    const name = chart ? chart.name : `${kind.toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`;
    const node = makeNode(nodeId(kind), kind, name, activeNamespace === "all" ? "default" : activeNamespace, {
      ...defaultsForKind(kind),
      ...(chart && {
        status: "Ready to Install",
        chart: {
          name: chart.name,
          description: chart.description,
          repository: chart.repository?.name || "",
          repositoryUrl: chart.repository?.url || "",
        },
        valuesYaml: "",
      }),
    });

    node.position = reactFlowInstance.project({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });

    addNode(node);
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
            <FolderOpen className="w-4 h-4" />
            Workflows
          </button>

          <button
            onClick={handleSave}
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
            onClick={handlePreview}
            disabled={compiling || applying || nodes.length === 0}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-sm font-medium text-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            title="Compile the graph and review the YAML"
          >
            {compiling ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCode className="w-4 h-4" />}
            Preview YAML
          </button>

          <button
            onClick={() => (compiled ? setShowPreview(true) : handlePreview())}
            disabled={applying || compiling || nodes.length === 0}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            title="Review, dry-run, then apply"
          >
            {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {applyState === "dry-running"
              ? "Validating..."
              : applyState === "applying"
              ? "Applying..."
              : "Apply to Cluster"}
          </button>

          {applyState === "success" && (
            <div className="flex items-center gap-1.5 text-green-400 px-2">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-xs font-medium">Applied!</span>
            </div>
          )}

          {dirty && (
            <span
              className="flex items-center gap-1.5 px-1 text-[10px] text-amber-400/90"
              title="You have unsaved changes"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              unsaved
            </span>
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
            <Eye className="w-4 h-4" />
            Deployed
          </Link>

          <Link
            href="/help"
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-sm font-medium text-gray-300 transition-colors flex items-center gap-2"
            title="Help & Instructions"
          >
            <HelpCircle className="w-4 h-4" />
            Help
          </Link>
        </div>
      </div>

      <ResourceToolbox />
      <HelmDashboard />
      <HelmReleaseManager />
      <KeyboardShortcuts
        onSave={handleSave}
        onRefresh={handleRefreshWorkflow}
        onDelete={handleDeleteSelected}
        onUndo={undo}
        onRedo={redo}
      />
      <DevModeIndicator />
      <AIPanel />

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

      {/* YAML preview — the gate between the graph and the cluster */}
      {showPreview && compiled && (
        <YamlPreview
          yaml={compiled.yaml}
          helmYaml={compiled.helmYaml}
          objects={compiled.objects}
          notes={compiled.notes || []}
          applying={applying}
          onApply={handleApply}
          onClose={() => setShowPreview(false)}
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
          onConnect={onConnect}
          isValidConnection={canConnect}
          onConnectStart={(_, { nodeId }) => (draggingFrom.current = nodeId)}
          onConnectEnd={handleConnectEnd}
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
          {nodes.length > 0 && (
            <Panel
              position="bottom-center"
              className="rounded border border-neutral-800 bg-neutral-900/90 px-3 py-1.5 backdrop-blur-sm"
            >
              <div className="flex items-center gap-3 whitespace-nowrap text-xs text-gray-400">
                <span>{filteredNodes.length} {filteredNodes.length === 1 ? "node" : "nodes"}</span>
                <span className="text-neutral-700">|</span>
                <span>{filteredEdges.length} {filteredEdges.length === 1 ? "connection" : "connections"}</span>
                <span className="text-neutral-700">|</span>
                <span className="text-blue-400">
                  {activeNamespace === "all" ? "All namespaces" : activeNamespace}
                </span>
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
