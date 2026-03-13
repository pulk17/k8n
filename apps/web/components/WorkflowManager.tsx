'use client';

import { useState, useEffect } from "react";
import { X, Plus, Trash2, Download, Upload, FileText } from "lucide-react";
import { useCanvasStore } from "../store/canvasStore";

interface WorkflowManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadWorkflow: (type: 'new' | 'example' | 'cluster' | 'saved', id?: string) => void;
}

export default function WorkflowManager({ isOpen, onClose, onLoadWorkflow }: WorkflowManagerProps) {
  const [savedWorkflows, setSavedWorkflows] = useState<any[]>([]);
  const [savedGraphs, setSavedGraphs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { nodes, edges, graphName } = useCanvasStore();
  const hasUnsavedChanges = nodes.length > 0;

  useEffect(() => {
    if (isOpen) {
      loadSavedWorkflows();
      loadSavedGraphs();
    }
  }, [isOpen]);

  const loadSavedGraphs = async () => {
    setLoading(true);
    try {
      // Load from database
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/graph/list`);
      if (response.ok) {
        const data = await response.json();
        setSavedGraphs(data || []);
      }
    } catch (err) {
      console.error('Failed to load saved graphs from DB', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSavedWorkflows = async () => {
    setLoading(true);
    try {
      // TODO: Implement API endpoint to list saved graphs
      // For now, use localStorage
      const saved = localStorage.getItem('k8n_workflows');
      if (saved) {
        setSavedWorkflows(JSON.parse(saved));
      }
    } catch (err) {
      console.error('Failed to load workflows', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCurrentWorkflow = () => {
    const workflow = {
      id: Date.now().toString(),
      name: graphName || 'Untitled Workflow',
      timestamp: new Date().toISOString(),
      nodes: nodes.length,
      edges: edges.length,
      data: { nodes, edges },
    };

    const saved = localStorage.getItem('k8n_workflows');
    const workflows = saved ? JSON.parse(saved) : [];
    workflows.push(workflow);
    localStorage.setItem('k8n_workflows', JSON.stringify(workflows));
    
    setSavedWorkflows(workflows);
  };

  const handleDeleteWorkflow = (id: string) => {
    if (!confirm('Delete this workflow?')) return;
    
    const saved = localStorage.getItem('k8n_workflows');
    if (saved) {
      const workflows = JSON.parse(saved).filter((w: any) => w.id !== id);
      localStorage.setItem('k8n_workflows', JSON.stringify(workflows));
      setSavedWorkflows(workflows);
    }
  };

  const handleLoadSaved = async (workflow: any) => {
    // Load from localStorage
    useCanvasStore.setState({
      nodes: workflow.data.nodes,
      edges: workflow.data.edges,
      graphName: workflow.name,
    });
    onLoadWorkflow('saved', workflow.id);
  };

  const handleLoadGraph = async (graph: any) => {
    // Load from database
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/graph/${graph.id}`);
      if (response.ok) {
        const data = await response.json();
        useCanvasStore.setState({
          graphId: data.id,
          graphName: data.name,
          activeNamespace: data.namespace,
          nodes: data.graph_json?.nodes || [],
          edges: data.graph_json?.edges || [],
        });
        onLoadWorkflow('saved', graph.id);
      }
    } catch (err) {
      console.error('Failed to load graph', err);
      alert('Failed to load graph from database');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800 max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-neutral-800 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Workflow Manager</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Unsaved Changes Warning */}
        {hasUnsavedChanges && (
          <div className="px-6 py-3 bg-yellow-50 dark:bg-yellow-950/20 border-b border-yellow-200 dark:border-yellow-800">
            <p className="text-sm text-yellow-800 dark:text-yellow-400">
              You have unsaved changes in the current workflow. Save before switching?
            </p>
            <button
              onClick={handleSaveCurrentWorkflow}
              className="mt-2 px-3 py-1 bg-yellow-600 hover:bg-yellow-700 text-white text-sm rounded transition-colors"
            >
              Save Current Workflow
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* New Workflow */}
            <button
              onClick={() => {
                if (hasUnsavedChanges && !confirm('Discard unsaved changes?')) return;
                onLoadWorkflow('new');
              }}
              className="p-6 border-2 border-dashed border-gray-300 dark:border-neutral-700 rounded-lg hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all text-left group"
            >
              <Plus className="w-8 h-8 text-gray-400 group-hover:text-blue-500 mb-3" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">New Workflow</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Start with an empty canvas</p>
            </button>

            {/* Example Workflow */}
            <button
              onClick={() => {
                if (hasUnsavedChanges && !confirm('Discard unsaved changes?')) return;
                onLoadWorkflow('example');
              }}
              className="p-6 border-2 border-gray-300 dark:border-neutral-700 rounded-lg hover:border-green-500 dark:hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-950/20 transition-all text-left group"
            >
              <FileText className="w-8 h-8 text-gray-400 group-hover:text-green-500 mb-3" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Example Workflow</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Nginx deployment with service</p>
            </button>

            {/* Load from Cluster */}
            <button
              onClick={() => {
                if (hasUnsavedChanges && !confirm('Discard unsaved changes?')) return;
                onLoadWorkflow('cluster');
              }}
              className="p-6 border-2 border-gray-300 dark:border-neutral-700 rounded-lg hover:border-purple-500 dark:hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-950/20 transition-all text-left group"
            >
              <Download className="w-8 h-8 text-gray-400 group-hover:text-purple-500 mb-3" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Import from Cluster</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Load live resources from K8s</p>
            </button>

            {/* Import JSON */}
            <button
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = (e: any) => {
                  const file = e.target.files[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                      try {
                        const data = JSON.parse(e.target?.result as string);
                        useCanvasStore.setState({
                          nodes: data.nodes || [],
                          edges: data.edges || [],
                          graphName: data.name || 'Imported Workflow',
                        });
                        onClose();
                      } catch (err) {
                        alert('Invalid workflow file');
                      }
                    };
                    reader.readAsText(file);
                  }
                };
                input.click();
              }}
              className="p-6 border-2 border-gray-300 dark:border-neutral-700 rounded-lg hover:border-orange-500 dark:hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/20 transition-all text-left group"
            >
              <Upload className="w-8 h-8 text-gray-400 group-hover:text-orange-500 mb-3" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Import Workflow</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Load from JSON file</p>
            </button>
          </div>

          {/* Saved Workflows */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Saved Workflows (Local)</h3>
            
            {savedWorkflows.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No local workflows saved yet</p>
            ) : (
              <div className="space-y-2">
                {savedWorkflows.map((workflow) => (
                  <div
                    key={workflow.id}
                    className="flex items-center justify-between p-4 bg-gray-50 dark:bg-neutral-800 rounded-lg border border-gray-200 dark:border-neutral-700 hover:border-blue-500 dark:hover:border-blue-500 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {workflow.name}
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {workflow.nodes} nodes • {workflow.edges} connections • {new Date(workflow.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (hasUnsavedChanges && !confirm('Discard unsaved changes?')) return;
                          handleLoadSaved(workflow);
                        }}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDeleteWorkflow(workflow.id)}
                        className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Saved Graphs from Database */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Saved Graphs (Database)</h3>
            
            {loading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading from database...</p>
            ) : savedGraphs.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No graphs saved in database yet. Use Ctrl+S to save.</p>
            ) : (
              <div className="space-y-2">
                {savedGraphs.map((graph) => (
                  <div
                    key={graph.id}
                    className="flex items-center justify-between p-4 bg-gray-50 dark:bg-neutral-800 rounded-lg border border-gray-200 dark:border-neutral-700 hover:border-green-500 dark:hover:border-green-500 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {graph.name}
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Namespace: {graph.namespace} • {new Date(graph.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (hasUnsavedChanges && !confirm('Discard unsaved changes?')) return;
                          handleLoadGraph(graph);
                        }}
                        className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors"
                      >
                        Load
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
