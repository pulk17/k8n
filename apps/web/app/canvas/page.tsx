"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactFlow, { Background, Controls, NodeTypes, ReactFlowInstance, BackgroundVariant, Panel, Connection } from "reactflow";
import "reactflow/dist/style.css";
import { useCanvasStore } from "../../store/canvasStore";
import K8sNode from "../../components/K8sNode";
import ResourceToolbox from "../../components/ResourceToolbox";
import NodeSettingsPanel from "../../components/NodeSettingsPanel";
import CanvasToolbar from "../../components/CanvasToolbar";
import HelmDashboard from "../../components/HelmDashboard";
import WelcomeScreen from "../../components/WelcomeScreen";
import WorkflowManager from "../../components/WorkflowManager";
import KeyboardShortcuts from "../../components/KeyboardShortcuts";
import DevModeIndicator from "../../components/DevModeIndicator";
import { Loader2 } from "lucide-react";

const nodeTypes: NodeTypes = {
  k8sNode: K8sNode,
};

function CanvasPageContent() {
  const { 
    nodes, 
    edges, 
    activeNamespace,
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
  } = useCanvasStore();

  const searchParams = useSearchParams();
  const graphIdToLoad = searchParams.get("id");

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [showWorkflowManager, setShowWorkflowManager] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

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
    
    const connectionRules: Record<string, string[]> = {
      Service: ['Deployment', 'StatefulSet', 'Pod'],
      Ingress: ['Service'],
      ConfigMap: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod'],
      Secret: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod'],
    };
    
    const sourceKind = sourceNode.data.kind;
    const targetKind = targetNode.data.kind;
    const allowedTargets = connectionRules[sourceKind] || [];
    
    if (allowedTargets.length > 0 && !allowedTargets.includes(targetKind)) {
      console.warn(`Invalid connection: ${sourceKind} cannot connect to ${targetKind}`);
      return;
    }
    
    useCanvasStore.getState().onConnect(connection);
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
    
    const colorMap: Record<string, string> = {
      Deployment: "#3b82f6",
      Service: "#22c55e",
      Pod: "#6b7280",
      ConfigMap: "#eab308",
      Secret: "#ef4444",
      StatefulSet: "#06b6d4",
      DaemonSet: "#f59e0b",
      Job: "#10b981",
      Ingress: "#ec4899",
      HelmRelease: "#ec4899",
    };

    let chartData = null;
    const helmStr = event.dataTransfer.getData("application/helmChart");
    if (helmStr) {
      try {
        chartData = JSON.parse(helmStr);
      } catch (e) {
        console.error("Failed to parse helm chart data", e);
      }
    }

    const newNodeName = chartData ? chartData.name : `${kind.toLowerCase()}-${Math.random().toString(36).substring(2, 7)}`;

    const newNode = {
      id: `${kind}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      type,
      position,
      data: {
        kind,
        name: newNodeName,
        namespace: activeNamespace === "all" ? "default" : activeNamespace,
        status: "Pending",
        color: colorMap[kind] || "#a855f7",
        chart: chartData,
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
    <div className="w-full h-screen relative bg-gray-50 dark:bg-neutral-950">
      {/* Navigation Links */}
      <div className="absolute top-4 right-4 z-40 flex items-center gap-2">
        <button
          onClick={() => setShowWorkflowManager(true)}
          className="px-3 py-2 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2"
          title="Workflow Manager"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          Workflows
        </button>
        <Link
          href="/deployed"
          className="px-3 py-2 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2"
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
          className="px-3 py-2 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2"
          title="Help & Instructions"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Help
        </Link>
      </div>

      <CanvasToolbar />
      <ResourceToolbox />
      <HelmDashboard />
      <KeyboardShortcuts 
        onSave={saveGraph}
        onRefresh={handleRefreshWorkflow}
        onDelete={handleDeleteSelected}
        onUndo={undo}
      />
      <DevModeIndicator />

      {/* Workflow Manager */}
      <WorkflowManager 
        isOpen={showWorkflowManager}
        onClose={() => setShowWorkflowManager(false)}
        onLoadWorkflow={handleLoadWorkflow}
      />

      {/* Welcome Screen for empty canvas */}
      {!loading && nodes.length === 0 && !showWorkflowManager && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
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

      <div className="w-full h-full" ref={reactFlowWrapper}>
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
          {nodes.length > 0 && (
            <Panel position="top-right" className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
              {filteredNodes.length} nodes • {filteredEdges.length} connections
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
