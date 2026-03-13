'use client';

import { memo, useState } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { Box, Database, Globe, FileCode, Lock, Layers, Briefcase, Clock, Network, ChevronDown, ChevronUp } from "lucide-react";
import { useCanvasStore } from "../store/canvasStore";

const iconMap: Record<string, any> = {
  Deployment: Box,
  Service: Globe,
  Pod: Box,
  ConfigMap: FileCode,
  Secret: Lock,
  ReplicaSet: Layers,
  StatefulSet: Database,
  DaemonSet: Briefcase,
  Job: Clock,
  CronJob: Clock,
  Ingress: Network,
  HelmRelease: Layers,
};

// ComfyUI-style connection types with colors
const connectionTypes = {
  workload: { color: '#3b82f6', label: 'Workload' }, // blue
  config: { color: '#eab308', label: 'Config' }, // yellow
  network: { color: '#22c55e', label: 'Network' }, // green
  routing: { color: '#ec4899', label: 'Routing' }, // pink
};

// Define what each node can connect to (ComfyUI-style typed connections)
const nodeConnectionRules: Record<string, { 
  outputs?: { type: string; color: string; label: string; accepts: string[] }[];
  inputs?: { type: string; color: string; label: string; from: string[] }[];
}> = {
  Service: {
    outputs: [{ 
      type: 'network', 
      color: connectionTypes.network.color, 
      label: 'Routes to',
      accepts: ['Deployment', 'StatefulSet', 'Pod'] 
    }],
    inputs: [{ 
      type: 'routing', 
      color: connectionTypes.routing.color, 
      label: 'Exposed by',
      from: ['Ingress'] 
    }]
  },
  Ingress: {
    outputs: [{ 
      type: 'routing', 
      color: connectionTypes.routing.color, 
      label: 'Routes to',
      accepts: ['Service'] 
    }]
  },
  ConfigMap: {
    outputs: [{ 
      type: 'config', 
      color: connectionTypes.config.color, 
      label: 'Config for',
      accepts: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod'] 
    }]
  },
  Secret: {
    outputs: [{ 
      type: 'config', 
      color: connectionTypes.config.color, 
      label: 'Secrets for',
      accepts: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod'] 
    }]
  },
  Deployment: {
    inputs: [
      { 
        type: 'network', 
        color: connectionTypes.network.color, 
        label: 'Service',
        from: ['Service'] 
      },
      { 
        type: 'config', 
        color: connectionTypes.config.color, 
        label: 'Config',
        from: ['ConfigMap', 'Secret'] 
      }
    ]
  },
  StatefulSet: {
    inputs: [
      { 
        type: 'network', 
        color: connectionTypes.network.color, 
        label: 'Service',
        from: ['Service'] 
      },
      { 
        type: 'config', 
        color: connectionTypes.config.color, 
        label: 'Config',
        from: ['ConfigMap', 'Secret'] 
      }
    ]
  },
  DaemonSet: {
    inputs: [
      { 
        type: 'config', 
        color: connectionTypes.config.color, 
        label: 'Config',
        from: ['ConfigMap', 'Secret'] 
      }
    ]
  },
  Pod: {
    inputs: [
      { 
        type: 'network', 
        color: connectionTypes.network.color, 
        label: 'Service',
        from: ['Service'] 
      },
      { 
        type: 'config', 
        color: connectionTypes.config.color, 
        label: 'Config',
        from: ['ConfigMap', 'Secret'] 
      }
    ]
  },
};

export default memo(function K8sNode({ data, id, selected }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(data.name);
  const updateNodeData = useCanvasStore(state => state.updateNodeData);

  const statusColors: Record<string, { bg: string; text: string; dot: string }> = {
    Running: { bg: "bg-green-50 dark:bg-green-950/20", text: "text-green-700 dark:text-green-400", dot: "bg-green-500" },
    Ready: { bg: "bg-green-50 dark:bg-green-950/20", text: "text-green-700 dark:text-green-400", dot: "bg-green-500" },
    Active: { bg: "bg-green-50 dark:bg-green-950/20", text: "text-green-700 dark:text-green-400", dot: "bg-green-500" },
    Pending: { bg: "bg-yellow-50 dark:bg-yellow-950/20", text: "text-yellow-700 dark:text-yellow-400", dot: "bg-yellow-500" },
    NotReady: { bg: "bg-yellow-50 dark:bg-yellow-950/20", text: "text-yellow-700 dark:text-yellow-400", dot: "bg-yellow-500" },
    Failed: { bg: "bg-red-50 dark:bg-red-950/20", text: "text-red-700 dark:text-red-400", dot: "bg-red-500" },
    Error: { bg: "bg-red-50 dark:bg-red-950/20", text: "text-red-700 dark:text-red-400", dot: "bg-red-500" },
    CrashLoopBackOff: { bg: "bg-red-50 dark:bg-red-950/20", text: "text-red-700 dark:text-red-400", dot: "bg-red-500" },
    Unknown: { bg: "bg-gray-50 dark:bg-gray-950/20", text: "text-gray-600 dark:text-gray-400", dot: "bg-gray-400" },
  };

  const statusStyle = statusColors[data.status] || statusColors.Unknown;
  const Icon = iconMap[data.kind] || Box;
  const rules = nodeConnectionRules[data.kind] || {};

  const handleFieldChange = (field: string, value: any) => {
    updateNodeData(id, { [field]: value });
  };

  const handleNameDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingName(true);
    setEditedName(data.name);
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditedName(e.target.value);
  };

  const handleNameBlur = () => {
    if (editedName.trim() && editedName !== data.name) {
      handleFieldChange('name', editedName.trim());
    } else {
      setEditedName(data.name);
    }
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setEditedName(data.name);
      setIsEditingName(false);
    }
  };

  return (
    <div 
      className={`
        relative bg-neutral-900 
        border rounded
        transition-all duration-150 min-w-[280px]
        ${selected ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-neutral-700'}
      `}
    >
      {/* Input Handles (Left side) - ComfyUI style with colors */}
      {rules.inputs?.map((input, idx) => (
        <Handle 
          key={`input-${idx}`}
          type="target" 
          position={Position.Left} 
          id={`input-${input.type}`}
          className="!w-4 !h-4 !border-2 !border-neutral-900 !-ml-2 hover:!scale-150 !transition-transform !cursor-pointer !rounded-sm group"
          style={{ 
            backgroundColor: input.color,
            top: `${30 + (idx * 25)}%`,
            zIndex: 10 
          }}
          title={`${input.label} (from ${input.from.join(', ')})`}
        />
      ))}
      
      {/* Header */}
      <div 
        className="px-3 py-2 border-b border-neutral-800 cursor-pointer hover:bg-neutral-800/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
        style={{ backgroundColor: `${data.color}10` }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Icon className="w-4 h-4 flex-shrink-0" style={{ color: data.color }} />
            <div className="flex flex-col flex-1 min-w-0">
              {isEditingName ? (
                <input
                  type="text"
                  value={editedName}
                  onChange={handleNameChange}
                  onBlur={handleNameBlur}
                  onKeyDown={handleNameKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  className="text-xs font-semibold bg-neutral-800 text-gray-100 px-1 py-0.5 rounded border border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full"
                />
              ) : (
                <span 
                  className="text-xs font-semibold text-gray-100 truncate cursor-text hover:text-blue-400 transition-colors"
                  onDoubleClick={handleNameDoubleClick}
                  title="Double-click to rename"
                >
                  {data.name}
                </span>
              )}
              <span className="text-[10px] text-gray-400 font-mono">
                {data.kind}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusStyle.dot}`} title={data.status} />
            {expanded ? <ChevronUp className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />}
          </div>
        </div>
      </div>

      {/* Expanded Content - ComfyUI style inline editing */}
      {expanded && (
        <div className="px-3 py-2 space-y-2 text-xs bg-neutral-900">
          {/* Namespace */}
          <div>
            <label className="block text-[10px] font-medium text-gray-400 mb-1">
              Namespace
            </label>
            <input
              type="text"
              value={data.namespace || 'default'}
              onChange={(e) => handleFieldChange('namespace', e.target.value)}
              className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Deployment-specific fields */}
          {data.kind === 'Deployment' && (
            <>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Replicas
                </label>
                <input
                  type="number"
                  min="1"
                  value={data.replicas || 1}
                  onChange={(e) => handleFieldChange('replicas', parseInt(e.target.value) || 1)}
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Image
                </label>
                <input
                  type="text"
                  value={data.image || ''}
                  onChange={(e) => handleFieldChange('image', e.target.value)}
                  placeholder="nginx:latest"
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          {/* Service-specific fields */}
          {data.kind === 'Service' && (
            <div>
              <label className="block text-[10px] font-medium text-gray-400 mb-1">
                Port
              </label>
              <input
                type="number"
                min="1"
                max="65535"
                value={data.port || 80}
                onChange={(e) => handleFieldChange('port', parseInt(e.target.value) || 80)}
                className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Status */}
          <div className={`px-2 py-1 ${statusStyle.bg} rounded flex items-center gap-2`}>
            <div className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
            <span className={`text-[10px] font-medium ${statusStyle.text}`}>
              {data.status}
            </span>
          </div>
        </div>
      )}

      {/* Collapsed view - show key info */}
      {!expanded && (
        <div className="px-3 py-2 space-y-1 bg-neutral-900">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-gray-400 font-mono">{data.namespace || 'default'}</span>
            <span className={`${statusStyle.text} font-medium`}>{data.status}</span>
          </div>
          {data.kind === 'Deployment' && data.replicas && (
            <div className="text-[10px] text-gray-400">
              Replicas: {data.replicas}
            </div>
          )}
          {data.kind === 'Service' && data.port && (
            <div className="text-[10px] text-gray-400">
              Port: {data.port}
            </div>
          )}
        </div>
      )}
      
      {/* Output Handles (Right side) - ComfyUI style with colors */}
      {rules.outputs?.map((output, idx) => (
        <Handle 
          key={`output-${idx}`}
          type="source" 
          position={Position.Right} 
          id={`output-${output.type}`}
          className="!w-4 !h-4 !border-2 !border-neutral-900 !-mr-2 hover:!scale-150 !transition-transform !cursor-pointer !rounded-sm"
          style={{ 
            backgroundColor: output.color,
            top: `${30 + (idx * 25)}%`,
            zIndex: 10 
          }}
          title={`${output.label} (${output.accepts.join(', ')})`}
        />
      ))}
    </div>
  );
});
