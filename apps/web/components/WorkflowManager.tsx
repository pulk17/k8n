'use client';

import { useState, useEffect } from "react";
import { X, Plus, Trash2, Download, Upload, FileText, FileCode, FileJson, Sparkles, FileType } from "lucide-react";
import { useCanvasStore } from "../store/canvasStore";
import { compileGraph } from "../lib/compiler";
import { API_URL } from "../lib/api";
import { templates, getAllCategories, getTemplatesByCategory } from "../lib/templates";
import { RESOURCE_COLORS, DEFAULT_RESOURCE_COLOR } from "../lib/constants";

interface WorkflowManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadWorkflow: (type: 'new' | 'example' | 'cluster' | 'saved', id?: string) => void;
}

export default function WorkflowManager({ isOpen, onClose, onLoadWorkflow }: WorkflowManagerProps) {
  const [savedWorkflows, setSavedWorkflows] = useState<any[]>([]);
  const [savedGraphs, setSavedGraphs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showImportModal, setShowImportModal] = useState<'yaml' | 'json' | 'dockerfile' | null>(null);
  const [importContent, setImportContent] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
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
      const response = await fetch(`${API_URL}/api/graph/list`);
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
      const response = await fetch(`${API_URL}/api/graph/${graph.id}`);
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

  const handleDeleteGraph = async (graphId: string) => {
    if (!confirm('Delete this workflow from database? This cannot be undone.')) return;
    
    try {
      const response = await fetch(`${API_URL}/api/graph/${graphId}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        // Reload the list
        loadSavedGraphs();
      } else {
        alert('Failed to delete workflow');
      }
    } catch (err) {
      console.error('Failed to delete graph', err);
      alert('Failed to delete workflow');
    }
  };

  const handleExportJSON = () => {
    const data = {
      name: graphName,
      nodes,
      edges,
      version: '1.0',
      exported: new Date().toISOString(),
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${graphName || 'workflow'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportYAML = async () => {
    try {
      const yaml = await compileGraph(nodes, edges);
      if (!yaml) {
        alert('No resources to export');
        return;
      }
      
      const blob = new Blob([yaml], { type: 'text/yaml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${graphName || 'workflow'}.yaml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export YAML', err);
      alert('Failed to export YAML');
    }
  };

  const handleImportYAML = () => {
    setShowImportModal('yaml');
    setImportContent('');
  };

  const handleImportJSON = () => {
    setShowImportModal('json');
    setImportContent('');
  };

  const handleImportDockerfile = () => {
    setShowImportModal('dockerfile');
    setImportContent('');
  };

  const handleLoadTemplate = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;

    // Generate unique IDs for nodes
    const newNodes = template.nodes.map((node, idx) => {
      return {
        ...node,
        id: `${node.data.kind}-${Date.now()}-${idx}`,
      };
    });

    // Create edges using the sourceIdx and targetIdx from template
    const newEdges = template.edges.map((edge, idx) => {
      const sourceNode = newNodes[edge.sourceIdx];
      const targetNode = newNodes[edge.targetIdx];
      
      if (!sourceNode || !targetNode) {
        console.error(`Invalid edge indices: ${edge.sourceIdx} -> ${edge.targetIdx}`);
        return null;
      }
      
      return {
        id: `edge-${idx}`,
        source: sourceNode.id,
        target: targetNode.id,
        type: "default",
        animated: edge.animated !== false, // Default to true if not specified
        style: { 
          stroke: edge.color || '#3b82f6', 
          strokeWidth: 2 
        },
      };
    }).filter(Boolean); // Remove any null edges

    useCanvasStore.setState({
      nodes: newNodes,
      edges: newEdges as any[],
      graphName: template.name,
    });

    setShowTemplates(false);
    onClose();
  };

  const handleImportFromFile = (type: 'yaml' | 'json') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = type === 'yaml' ? '.yaml,.yml' : '.json';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const content = e.target?.result as string;
          setImportContent(content);
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const handleImportSubmit = async () => {
    if (!importContent.trim()) {
      alert('Please paste or upload content');
      return;
    }

    try {
      if (showImportModal === 'yaml') {
        await parseYAMLToNodes(importContent);
      } else if (showImportModal === 'json') {
        const data = JSON.parse(importContent);
        useCanvasStore.setState({
          nodes: data.nodes || [],
          edges: data.edges || [],
          graphName: data.name || 'Imported Workflow',
        });
      } else if (showImportModal === 'dockerfile') {
        await parseDockerfileToNodes(importContent);
      }
      setShowImportModal(null);
      setImportContent('');
      onClose();
    } catch (err) {
      console.error('Failed to import', err);
      alert(`Failed to import ${showImportModal?.toUpperCase()}: ${err}`);
    }
  };

  const parseDockerfileToNodes = async (dockerfileContent: string) => {
    // Parse Dockerfile and create a deployment
    const lines = dockerfileContent.split('\n');
    let imageName = 'custom-app';
    let port = 80;
    let envVars: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('FROM ')) {
        const parts = trimmed.split(' ');
        if (parts[1]) {
          imageName = parts[1].split(':')[0];
        }
      } else if (trimmed.startsWith('EXPOSE ')) {
        const portMatch = trimmed.match(/EXPOSE\s+(\d+)/);
        if (portMatch) {
          port = parseInt(portMatch[1]);
        }
      } else if (trimmed.startsWith('ENV ')) {
        const envMatch = trimmed.match(/ENV\s+(\w+)=(.+)/);
        if (envMatch) {
          envVars.push(`${envMatch[1]}=${envMatch[2]}`);
        }
      }
    }

    const newNodes: any[] = [];
    const newEdges: any[] = [];

    // Create ConfigMap if there are env vars
    if (envVars.length > 0) {
      newNodes.push({
        id: `configmap-${Date.now()}`,
        type: 'k8sNode',
        position: { x: 100, y: 50 },
        data: {
          kind: 'ConfigMap',
          name: `${imageName}-config`,
          namespace: 'default',
          status: 'Active',
          color: '#eab308',
          configData: envVars.join('\n'),
        },
      });
    }

    // Create Deployment
    const deploymentId = `deployment-${Date.now()}`;
    newNodes.push({
      id: deploymentId,
      type: 'k8sNode',
      position: { x: 100, y: envVars.length > 0 ? 200 : 100 },
      data: {
        kind: 'Deployment',
        name: imageName,
        namespace: 'default',
        status: 'Pending',
        color: '#3b82f6',
        replicas: 2,
        image: 'your-registry/' + imageName + ':latest',
        containerPort: port,
      },
    });

    // Create Service
    const serviceId = `service-${Date.now()}`;
    newNodes.push({
      id: serviceId,
      type: 'k8sNode',
      position: { x: 400, y: envVars.length > 0 ? 200 : 100 },
      data: {
        kind: 'Service',
        name: `${imageName}-service`,
        namespace: 'default',
        status: 'Active',
        color: '#22c55e',
        port: port,
        targetPort: port,
        serviceType: 'LoadBalancer',
      },
    });

    // Create edges
    if (envVars.length > 0) {
      newEdges.push({
        id: 'edge-0',
        source: newNodes[0].id,
        target: deploymentId,
        animated: false,
      });
    }

    newEdges.push({
      id: 'edge-1',
      source: serviceId,
      target: deploymentId,
      animated: true,
    });

    useCanvasStore.setState({
      nodes: newNodes,
      edges: newEdges,
      graphName: `${imageName} from Dockerfile`,
    });
  };

  const parseYAMLToNodes = async (yamlContent: string) => {
    // Split YAML by document separator
    const docs = yamlContent.split(/^---$/m).filter(d => d.trim());
    
    const newNodes: any[] = [];
    const newEdges: any[] = [];
    const nodeMap = new Map<string, string>(); // Map of resource name to node ID
    
    // Parse each document
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i].trim();
      if (!doc) continue;
      
      // Extract kind, name, namespace using regex (simple parsing)
      const kindMatch = doc.match(/kind:\s*(\w+)/);
      const nameMatch = doc.match(/name:\s*([^\n]+)/);
      const namespaceMatch = doc.match(/namespace:\s*([^\n]+)/);
      
      if (!kindMatch || !nameMatch) continue;
      
      const kind = kindMatch[1];
      const name = nameMatch[1].trim();
      const namespace = namespaceMatch ? namespaceMatch[1].trim() : 'default';
      
      const nodeId = `${kind}-${Date.now()}-${i}`;
      nodeMap.set(`${namespace}/${kind}/${name}`, nodeId);
      
      // Extract additional fields based on kind
      let additionalData: any = {};
      
      if (kind === 'Deployment') {
        const replicasMatch = doc.match(/replicas:\s*(\d+)/);
        const imageMatch = doc.match(/image:\s*([^\n]+)/);
        additionalData.replicas = replicasMatch ? parseInt(replicasMatch[1]) : 1;
        additionalData.image = imageMatch ? imageMatch[1].trim() : '';
      } else if (kind === 'Service') {
        const portMatch = doc.match(/port:\s*(\d+)/);
        additionalData.port = portMatch ? parseInt(portMatch[1]) : 80;
      }
      
      const colorMap = RESOURCE_COLORS;
      
      newNodes.push({
        id: nodeId,
        type: 'k8sNode',
        position: { x: 100 + (i % 5) * 350, y: 100 + Math.floor(i / 5) * 200 },
        data: {
          kind,
          name,
          namespace,
          status: 'Pending',
          color: colorMap[kind] || "#a855f7",
          ...additionalData,
        },
      });
    }
    
    // Create edges based on common patterns
    newNodes.forEach((node, idx) => {
      if (node.data.kind === 'Service') {
        // Find matching Deployment
        const deployment = newNodes.find(n => 
          n.data.kind === 'Deployment' && 
          n.data.namespace === node.data.namespace
        );
        if (deployment) {
          newEdges.push({
            id: `edge-${idx}`,
            source: node.id,
            target: deployment.id,
            animated: true,
          });
        }
      }
    });
    
    useCanvasStore.setState({
      nodes: newNodes,
      edges: newEdges,
      graphName: 'Imported from YAML',
    });
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
          {/* Export Options */}
          {nodes.length > 0 && (
            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">Export Current Workflow</h3>
              <div className="flex gap-2">
                <button
                  onClick={handleExportJSON}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
                >
                  <FileJson className="w-4 h-4" />
                  Export as JSON
                </button>
                <button
                  onClick={handleExportYAML}
                  className="flex items-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded transition-colors"
                >
                  <FileCode className="w-4 h-4" />
                  Export as YAML
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Templates */}
            <button
              onClick={() => setShowTemplates(true)}
              className="p-6 border-2 border-gray-300 dark:border-neutral-700 rounded-lg hover:border-yellow-500 dark:hover:border-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-950/20 transition-all text-left group"
            >
              <Sparkles className="w-8 h-8 text-gray-400 group-hover:text-yellow-500 mb-3" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Templates</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">10 ready-to-use templates</p>
            </button>

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

            {/* Import YAML */}
            <button
              onClick={handleImportYAML}
              className="p-6 border-2 border-gray-300 dark:border-neutral-700 rounded-lg hover:border-indigo-500 dark:hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 transition-all text-left group"
            >
              <FileCode className="w-8 h-8 text-gray-400 group-hover:text-indigo-500 mb-3" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Import YAML</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Parse K8s YAML into workflow</p>
            </button>

            {/* Import JSON */}
            <button
              onClick={handleImportJSON}
              className="p-6 border-2 border-gray-300 dark:border-neutral-700 rounded-lg hover:border-orange-500 dark:hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/20 transition-all text-left group"
            >
              <Upload className="w-8 h-8 text-gray-400 group-hover:text-orange-500 mb-3" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Import JSON</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Load workflow from JSON file</p>
            </button>

            {/* Import Dockerfile */}
            <button
              onClick={handleImportDockerfile}
              className="p-6 border-2 border-gray-300 dark:border-neutral-700 rounded-lg hover:border-cyan-500 dark:hover:border-cyan-500 hover:bg-cyan-50 dark:hover:bg-cyan-950/20 transition-all text-left group"
            >
              <FileType className="w-8 h-8 text-gray-400 group-hover:text-cyan-500 mb-3" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Import Dockerfile</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Generate workflow from Dockerfile</p>
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
                        {workflow.nodes} {workflow.nodes === 1 ? 'node' : 'nodes'} • {workflow.edges} {workflow.edges === 1 ? 'connection' : 'connections'} • {new Date(workflow.timestamp).toLocaleDateString()}
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
                      <button
                        onClick={() => handleDeleteGraph(graph.id)}
                        className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded transition-colors"
                        title="Delete workflow"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800 max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-neutral-800 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Import {showImportModal === 'dockerfile' ? 'Dockerfile' : showImportModal.toUpperCase()}
              </h2>
              <button
                onClick={() => {
                  setShowImportModal(null);
                  setImportContent('');
                }}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                {/* Upload File Button */}
                <div>
                  <button
                    onClick={() => handleImportFromFile(showImportModal as 'yaml' | 'json')}
                    className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded transition-colors flex items-center justify-center gap-2"
                  >
                    <Upload className="w-5 h-5" />
                    Upload {showImportModal === 'dockerfile' ? 'Dockerfile' : showImportModal.toUpperCase()} File
                  </button>
                </div>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-300 dark:border-neutral-700"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white dark:bg-neutral-900 text-gray-500 dark:text-gray-400">
                      or paste content below
                    </span>
                  </div>
                </div>

                {/* Textarea */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Paste {showImportModal === 'dockerfile' ? 'Dockerfile' : showImportModal.toUpperCase()} Content
                  </label>
                  <textarea
                    value={importContent}
                    onChange={(e) => setImportContent(e.target.value)}
                    placeholder={
                      showImportModal === 'yaml'
                        ? 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: nginx\n...'
                        : showImportModal === 'json'
                        ? '{\n  "name": "My Workflow",\n  "nodes": [...],\n  "edges": [...]\n}'
                        : 'FROM node:18-alpine\nWORKDIR /app\nCOPY . .\nEXPOSE 3000\nCMD ["npm", "start"]'
                    }
                    className="w-full h-96 px-3 py-2 text-sm font-mono bg-gray-50 dark:bg-neutral-800 border border-gray-300 dark:border-neutral-700 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                  />
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {showImportModal === 'yaml'
                      ? 'Paste Kubernetes YAML manifests. Multiple resources separated by --- are supported.'
                      : showImportModal === 'json'
                      ? 'Paste k8n workflow JSON with nodes and edges.'
                      : 'Paste Dockerfile content. Will generate Deployment, Service, and ConfigMap based on Dockerfile instructions.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 dark:border-neutral-800 flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowImportModal(null);
                  setImportContent('');
                }}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-gray-700 dark:text-gray-300 font-medium rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImportSubmit}
                disabled={!importContent.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Templates Modal */}
      {showTemplates && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800 max-w-6xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-neutral-800 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <Sparkles className="w-6 h-6 text-yellow-500" />
                  Workflow Templates
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Choose a pre-built template to get started quickly
                </p>
              </div>
              <button
                onClick={() => setShowTemplates(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Category Filter */}
            <div className="px-6 py-3 border-b border-gray-200 dark:border-neutral-800 flex items-center gap-2 overflow-x-auto">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`px-3 py-1 text-sm font-medium rounded transition-colors whitespace-nowrap ${
                  selectedCategory === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-neutral-700'
                }`}
              >
                All
              </button>
              {getAllCategories().map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-3 py-1 text-sm font-medium rounded transition-colors whitespace-nowrap ${
                    selectedCategory === category
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-neutral-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-neutral-700'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>

            {/* Templates Grid */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(selectedCategory === 'all' ? templates : getTemplatesByCategory(selectedCategory)).map((template) => (
                  <button
                    key={template.id}
                    onClick={() => {
                      if (hasUnsavedChanges && !confirm('Discard unsaved changes?')) return;
                      handleLoadTemplate(template.id);
                    }}
                    className="p-4 border-2 border-gray-200 dark:border-neutral-800 rounded-lg hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all text-left group"
                  >
                    <div className="text-3xl mb-3">{template.icon}</div>
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {template.name}
                    </h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                      {template.description}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-500">
                      <span className="px-2 py-0.5 bg-gray-100 dark:bg-neutral-800 rounded">
                        {template.category}
                      </span>
                      <span>{template.nodes.length} resources</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
