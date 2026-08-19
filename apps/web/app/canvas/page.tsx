"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  Edge,
  Node,
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
import CanvasToolbar, { ApplyState } from "../../components/CanvasToolbar";
import Inspector, { INSPECTOR_WIDTH } from "../../components/Inspector";
import HelmDashboard from "../../components/HelmDashboard";
import HelmReleaseManager from "../../components/HelmReleaseManager";
import WorkflowManager from "../../components/WorkflowManager";
import KeyboardShortcuts from "../../components/KeyboardShortcuts";
import DevModeIndicator from "../../components/DevModeIndicator";
import ApiConnectionError from "../../components/ApiConnectionError";
import GraphChecks from "../../components/GraphChecks";
import { AlertCircle, Loader2, RefreshCw, X } from "lucide-react";
import { ApiError, CompileResult, applyYaml, compileGraph, errorMessage, installHelmChart, watchResources } from "../../lib/api";
import { isValidConnection, validTargetsFor } from "../../lib/connections";
import { defaultsForKind } from "../../lib/nodeSchema";
import { makeNode, nodeId, NodeData } from "../../lib/graph";
import { checkGraph, issuesByNode } from "../../lib/graphChecks";
import { notify, notifyError } from "../../lib/dialog";
import YamlPreview from "../../components/YamlPreview";
import AIPanel from "../../components/AIPanel";

const nodeTypes: NodeTypes = {
  k8sNode: K8sNode,
};

// The toolbox floats over the left edge of the canvas and the inspector over
// the right, so fitView — which centres in the full viewport — used to tuck the
// leftmost nodes underneath the toolbox. The fit is computed against the strip
// that is actually visible between the two instead.
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
    showPods,
    setShowPods,
    showSystemNamespaces,
    setShowSystemNamespaces,
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
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);

  const applying = applyState === "dry-running" || applyState === "applying";
  const inspectorOpen = Boolean(selectedNodeId || selectedEdge);

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
  }, [nodes, edges, activeNamespace]);

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

    if (type === "new") {
      clearCanvas();
    } else if (type === "example") {
      useCanvasStore.getState().createStarterWorkflow();
    } else if (type === "cluster") {
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

  // Runs on every graph change. Cheap, and never touches the cluster — the
  // point is to catch a Service that selects nothing before it is applied,
  // not after.
  const issues = useMemo(
    () => checkGraph(filteredNodes as Node<NodeData>[], filteredEdges),
    [filteredNodes, filteredEdges]
  );

  // The cards get a badge for their own issues. Carried as a count and a
  // summary string rather than the objects themselves, so lib/graph does not
  // have to know the check types exist.
  const displayNodes = useMemo(() => {
    const byNode = issuesByNode(issues);
    if (byNode.size === 0) return filteredNodes;
    return filteredNodes.map(node => {
      const found = byNode.get(node.id);
      if (!found) return node;
      return {
        ...node,
        data: {
          ...node.data,
          issueCount: found.length,
          issueSummary: found.map(i => i.title).join("\n"),
        },
      };
    });
  }, [filteredNodes, issues]);

  const selectNode = useCallback((id: string) => {
    useCanvasStore.setState({ selectedNodeId: id });
    setSelectedEdge(null);
  }, []);

  const closeInspector = useCallback(() => {
    useCanvasStore.setState({ selectedNodeId: null });
    setSelectedEdge(null);
  }, []);

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
    if (nodes.some(n => n.data.origin === "cluster")) {
      hydrateGraph();
    } else {
      notify("This workflow was built on the canvas — nothing to refresh from the cluster.");
    }
  }, [nodes, hydrateGraph]);

  /** The strip of canvas not covered by the toolbox or the inspector. */
  const visibleCanvas = useCallback(() => {
    const container = reactFlowWrapper.current;
    if (!container) return null;
    const right = inspectorOpen ? INSPECTOR_WIDTH : 0;
    return {
      left: TOOLBOX_WIDTH,
      width: container.clientWidth - TOOLBOX_WIDTH - right,
      height: container.clientHeight,
    };
  }, [inspectorOpen]);

  /**
   * Frames the graph in the part of the canvas nothing is covering. fitView on
   * its own centres in the full viewport, which tucked the leftmost nodes
   * underneath the toolbox, so the fit is computed against the visible width
   * and then shifted back past it.
   */
  const frameGraph = useCallback(() => {
    const flow = reactFlowInstance;
    const area = visibleCanvas();
    if (!flow || !area) return;

    // Node sizes are only known once React Flow has measured them, and a fresh
    // graph is not measured in the same tick it is set. Without waiting, the
    // bounds come out short and the rightmost node ends up off-screen.
    const current = flow.getNodes();
    if (current.length === 0 || current.some(n => !n.width || !n.height)) {
      requestAnimationFrame(frameGraph);
      return;
    }

    if (area.width < 200) return;

    const [x, y, zoom] = getTransformForBounds(
      getRectOfNodes(current),
      area.width,
      area.height,
      0.2,
      1.5,
      0.12
    );
    flow.setViewport({ x: x + area.left, y, zoom }, { duration: 200 });
  }, [reactFlowInstance, visibleCanvas]);

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
      closeInspector();
    }
  }, [selectedNodeId, deleteNode, closeInspector]);

  /** Compiles the graph and opens the preview; nothing reaches the cluster yet. */
  const handlePreview = useCallback(async () => {
    setErrors([]);
    setCompiling(true);
    try {
      const result = await compileGraph(filteredNodes, filteredEdges);
      setCompiled(result);
      setShowPreview(true);
      if (result.objects === 0 && !filteredNodes.some(n => n.data.kind === "HelmRelease")) {
        notify("Nothing to apply — the graph compiled to no resources.");
      }
    } catch (err) {
      setErrors([{ resource: "Compile", message: errorMessage(err) }]);
    } finally {
      setCompiling(false);
    }
  }, [filteredNodes, filteredEdges]);

  // One entry point to the cluster. The preview is the only place Apply lives,
  // so there is no path that skips the review and the dry run.
  const handleReviewAndApply = useCallback(() => {
    if (compiled) setShowPreview(true);
    else handlePreview();
  }, [compiled, handlePreview]);

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
      for (const node of filteredNodes.filter(n => n.data.kind === "HelmRelease")) {
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
  }, [compiled, filteredNodes]);

  /** Builds a node of `kind` at a position on the canvas. */
  const createNode = useCallback((kind: string, position: { x: number; y: number }, chart?: {
    name: string; description: string; repository?: { name: string; url: string };
  } | null) => {
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
    node.position = position;
    addNode(node);
  }, [activeNamespace, addNode]);

  /**
   * Adds a resource without dragging — the toolbox rows are buttons too, so
   * there is a keyboard path onto the canvas. It lands in the middle of the
   * visible strip rather than the middle of the window, which would be under
   * the inspector whenever one is open.
   *
   * Dropping it straight on the centre put it on top of whatever was already
   * there, so it steps diagonally until it finds clear space. Cards are about
   * 280x150, and stepping by less than that only half-hides the one beneath.
   */
  const addAtCentre = useCallback((kind: string) => {
    const area = visibleCanvas();
    if (!reactFlowInstance || !area) return;

    const position = reactFlowInstance.project({
      x: area.left + area.width / 2,
      y: area.height / 2,
    });

    const clashes = (x: number, y: number) =>
      nodes.some(n => Math.abs(n.position.x - x) < 300 && Math.abs(n.position.y - y) < 170);

    // Bounded so a busy canvas cannot spin here; after ten steps it is far
    // enough away to be visible regardless.
    for (let step = 0; step < 10 && clashes(position.x, position.y); step++) {
      position.x += 40;
      position.y += 60;
    }

    createNode(kind, position);
  }, [reactFlowInstance, visibleCanvas, createNode, nodes]);

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

    createNode(kind, reactFlowInstance.project({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }), chart);
  }, [reactFlowInstance, createNode]);

  if (loading && nodes.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-950">
        <Loader2 className="mb-4 h-12 w-12 animate-spin text-blue-500" />
        <p className="font-medium text-gray-400">Loading cluster graph…</p>
      </div>
    );
  }

  if (error && nodes.length === 0) {
    if (error.includes("Cannot connect to API server")) {
      return <ApiConnectionError error={error} onRetry={hydrateGraph} />;
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-950">
        <div className="max-w-md rounded-lg border border-red-900/50 bg-neutral-900 p-8">
          <h2 className="mb-2 text-xl font-bold text-red-400">Connection Error</h2>
          <p className="mb-4 text-gray-300">{error}</p>
          <a
            href="/connect"
            className="block w-full rounded bg-blue-600 px-4 py-2 text-center font-medium text-white transition-colors hover:bg-blue-700"
          >
            Go to Connect Page
          </a>
        </div>
      </div>
    );
  }

  return (
    // --dock-width is how everything anchored to the right edge — the AI panel,
    // the dev indicator, the zoom controls — keeps clear of the inspector
    // without any of them having to know the inspector exists.
    <div
      className="relative h-screen w-full overflow-hidden bg-neutral-950"
      style={{ "--dock-width": inspectorOpen ? `${INSPECTOR_WIDTH}px` : "0px" } as React.CSSProperties}
    >
      <CanvasToolbar
        graphName={graphName}
        onGraphNameChange={setGraphName}
        dirty={dirty}
        applyState={applyState}
        busy={compiling || applying}
        canApply={filteredNodes.length > 0}
        onOpenWorkflows={() => setShowWorkflowManager(true)}
        onSave={handleSave}
        onRefresh={handleRefreshWorkflow}
        onReviewAndApply={handleReviewAndApply}
        namespaces={namespaces}
        activeNamespace={activeNamespace}
        onNamespaceChange={setActiveNamespace}
        showPods={showPods}
        onShowPodsChange={setShowPods}
        showSystemNamespaces={showSystemNamespaces}
        onShowSystemNamespacesChange={setShowSystemNamespaces}
      />

      <ResourceToolbox onAdd={addAtCentre} />
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

      {/* Keyed on the selection so a different resource gets a fresh panel —
          which is what resets the tab and reloads the live figures. */}
      {inspectorOpen && (
        <Inspector
          key={selectedNodeId ?? selectedEdge?.id ?? "none"}
          selectedEdge={selectedEdge}
          issues={issues.filter(i => i.nodeId === selectedNodeId)}
          onClose={closeInspector}
        />
      )}

      {error && (
        <div className="absolute inset-x-0 top-12 z-40 flex items-center justify-between gap-3 border-b border-red-800 bg-red-950/90 px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-400" />
            <span className="truncate text-xs text-red-300">{error}</span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              onClick={hydrateGraph}
              className="flex items-center gap-1 rounded bg-red-800 px-2 py-1 text-xs text-red-200 transition-colors hover:bg-red-700"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
            <a
              href="/connect"
              className="flex items-center gap-1 rounded bg-blue-700 px-2 py-1 text-xs text-white transition-colors hover:bg-blue-600"
            >
              Connect to Cluster
            </a>
          </div>
        </div>
      )}

      {/* YAML preview — the gate between the graph and the cluster */}
      {showPreview && compiled && (
        <YamlPreview
          yaml={compiled.yaml}
          helmYaml={compiled.helmYaml}
          objects={compiled.objects}
          notes={compiled.notes || []}
          scope={activeNamespace === "all" ? "all namespaces" : `namespace ${activeNamespace}`}
          applying={applying}
          onApply={handleApply}
          onClose={() => setShowPreview(false)}
        />
      )}

      <WorkflowManager
        isOpen={showWorkflowManager}
        onClose={() => setShowWorkflowManager(false)}
        onLoadWorkflow={handleLoadWorkflow}
      />

      {!loading && nodes.length === 0 && !showWorkflowManager && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center pt-12">
          <div className="pointer-events-auto max-w-sm text-center">
            <h2 className="text-lg font-semibold text-gray-200">Nothing on the canvas yet</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
              Drag a resource in from the left, import what is already running in your cluster, or
              start from an example that wires a Deployment, Service and Ingress together.
            </p>
            <button
              onClick={() => setShowWorkflowManager(true)}
              className="mt-4 rounded bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Open workflow manager
            </button>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="absolute left-1/2 top-16 z-50 max-h-80 w-[500px] -translate-x-1/2 overflow-y-auto rounded-lg border-2 border-red-600 bg-neutral-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-red-900/30 bg-red-950/50 px-4 py-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400" />
              <h4 className="text-sm font-semibold text-red-300">Apply errors</h4>
            </div>
            <button
              onClick={() => setErrors([])}
              aria-label="Dismiss errors"
              className="text-red-400 hover:text-red-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2 p-3">
            {errors.map((e, i) => (
              <div key={i} className="rounded border border-red-900/30 bg-red-950/20 p-2">
                <div className="mb-1 text-xs font-semibold text-red-300">{e.resource}</div>
                <div className="font-mono text-xs text-red-400">{e.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="h-full w-full pt-12" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={displayNodes}
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
          onNodeClick={(_, node) => selectNode(node.id)}
          // Selecting a wire explains the relationship it stands for, which is
          // the only place the canvas can teach why two objects are separate.
          onEdgeClick={(_, edge) => {
            setSelectedEdge(edge);
            useCanvasStore.setState({ selectedNodeId: null });
          }}
          onPaneClick={closeInspector}
          minZoom={0.1}
          maxZoom={2}
          // No defaultEdgeOptions: every edge carries the colour, dash and
          // animation for its connection type from lib/edges, and a default
          // blue stroke here only ever misled whoever read it next.
        >
          <Background gap={20} size={1} color="#262626" variant={BackgroundVariant.Dots} />
          <Controls
            position="bottom-right"
            className="overflow-hidden rounded border border-neutral-800 shadow-sm"
            style={{ right: "calc(var(--dock-width, 0px) + 1rem)" }}
          />
          {nodes.length > 0 && (
            <Panel position="bottom-center">
              <GraphChecks
                nodeCount={filteredNodes.length}
                edgeCount={filteredEdges.length}
                scopeLabel={activeNamespace === "all" ? "All namespaces" : activeNamespace}
                issues={issues}
                onSelectNode={selectNode}
              />
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
      <div className="flex min-h-screen items-center justify-center bg-neutral-950">
        <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
      </div>
    }>
      <CanvasPageContent />
    </Suspense>
  );
}
