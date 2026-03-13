'use client';

import { useEffect, useState } from "react";
import { useCanvasStore } from "../store/canvasStore";
import { X, Save, Trash2, Settings } from "lucide-react";

export default function NodeSettingsPanel() {
  const { nodes, selectedNodeId, updateNodeData, deleteNode } = useCanvasStore();
  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  
  const [formData, setFormData] = useState<any>({});

  useEffect(() => {
    if (selectedNode) {
      setFormData({
        name: selectedNode.data.name || "",
        namespace: selectedNode.data.namespace || "default",
        replicas: selectedNode.data.replicas || 1,
        image: selectedNode.data.image || "",
        port: selectedNode.data.port || 80,
      });
    } else {
      // Reset form when no node is selected
      setFormData({
        name: "",
        namespace: "default",
        replicas: 1,
        image: "",
        port: 80,
      });
    }
  }, [selectedNode]);

  if (!selectedNode) {
    return null;
  }

  const handleSave = () => {
    updateNodeData(selectedNode.id, formData);
  };

  const handleDelete = () => {
    if (confirm(`Delete ${selectedNode.data.name}?`)) {
      deleteNode(selectedNode.id);
    }
  };

  const isAppliedResource = selectedNode.data.uid && selectedNode.data.uid.length > 20;
  const canRename = !isAppliedResource;

  return (
    <div className="absolute top-20 right-4 z-10 w-80 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 dark:bg-neutral-800 border-b border-gray-200 dark:border-neutral-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-gray-700 dark:text-gray-300" />
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Node Settings</h2>
        </div>
        <button 
          onClick={() => useCanvasStore.setState({ selectedNodeId: null })}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
        {/* Kind Badge */}
        <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-neutral-800 rounded border border-gray-200 dark:border-neutral-700">
          <div 
            className="w-3 h-3 rounded-full" 
            style={{ backgroundColor: selectedNode.data.color }}
          />
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Resource Type</div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {selectedNode.data.kind}
            </div>
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Name
            {!canRename && (
              <span className="ml-2 text-xs text-yellow-600 dark:text-yellow-400">
                (Applied resources cannot be renamed)
              </span>
            )}
          </label>
          <input
            type="text"
            value={formData.name || ""}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            disabled={!canRename}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-neutral-700 rounded bg-white dark:bg-neutral-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            title={!canRename ? "Kubernetes resources cannot be renamed after creation. Create a new resource instead." : ""}
          />
          {!canRename && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              K8s doesn't support renaming. Delete and recreate to change name.
            </p>
          )}
        </div>

        {/* Namespace */}
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Namespace
          </label>
          <input
            type="text"
            value={formData.namespace || "default"}
            onChange={(e) => setFormData({ ...formData, namespace: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-neutral-700 rounded bg-white dark:bg-neutral-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>

        {/* Deployment-specific fields */}
        {selectedNode.data.kind === "Deployment" && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Replicas
              </label>
              <input
                type="number"
                min="1"
                value={formData.replicas || 1}
                onChange={(e) => setFormData({ ...formData, replicas: parseInt(e.target.value) || 1 })}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-neutral-700 rounded bg-white dark:bg-neutral-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Container Image
              </label>
              <input
                type="text"
                value={formData.image || ""}
                onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                placeholder="nginx:latest"
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-neutral-700 rounded bg-white dark:bg-neutral-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
          </>
        )}

        {/* Service-specific fields */}
        {selectedNode.data.kind === "Service" && (
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Port
            </label>
            <input
              type="number"
              min="1"
              max="65535"
              value={formData.port || 80}
              onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 80 })}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-neutral-700 rounded bg-white dark:bg-neutral-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>
        )}

        {/* Status Display */}
        <div className="p-3 bg-gray-50 dark:bg-neutral-800 rounded border border-gray-200 dark:border-neutral-700">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Current Status</div>
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {selectedNode.data.status}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="border-t border-gray-200 dark:border-neutral-800 p-3 flex gap-2">
        <button
          onClick={handleSave}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors"
        >
          <Save className="w-4 h-4" />
          Save
        </button>
        <button
          onClick={handleDelete}
          className="px-4 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 text-sm font-medium rounded transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
