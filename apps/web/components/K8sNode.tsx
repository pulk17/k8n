'use client';

import { memo, useState } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { Box, Database, Globe, FileCode, Lock, Layers, Briefcase, Clock, Network, ChevronDown, ChevronUp } from "lucide-react";
import { useCanvasStore } from "../store/canvasStore";
import { CONNECTION_TYPES } from "../lib/constants";

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
  PersistentVolumeClaim: Database,
  PersistentVolume: Database,
  Namespace: Layers,
  ServiceAccount: Lock,
  Role: Lock,
  RoleBinding: Lock,
  ClusterRole: Lock,
  ClusterRoleBinding: Lock,
  NetworkPolicy: Network,
  HorizontalPodAutoscaler: Layers,
  VerticalPodAutoscaler: Layers,
};

// ComfyUI-style connection types with colors — sourced from shared constants
const connectionTypes = CONNECTION_TYPES;

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
      accepts: ['Deployment', 'StatefulSet', 'Pod', 'HelmRelease'] 
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
      accepts: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod', 'HelmRelease'] 
    }]
  },
  Secret: {
    outputs: [{ 
      type: 'config', 
      color: connectionTypes.config.color, 
      label: 'Secrets for',
      accepts: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod', 'HelmRelease'] 
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
  HelmRelease: {
    outputs: [
      { 
        type: 'helm', 
        color: connectionTypes.helm.color, 
        label: 'Deploys',
        accepts: ['Deployment', 'StatefulSet', 'Service', 'Ingress', 'ConfigMap', 'Secret'] 
      }
    ],
    inputs: [
      { 
        type: 'config', 
        color: connectionTypes.config.color, 
        label: 'Values',
        from: ['ConfigMap', 'Secret'] 
      }
    ]
  },
  PersistentVolumeClaim: {
    outputs: [
      { 
        type: 'storage', 
        color: connectionTypes.storage.color, 
        label: 'Volume for',
        accepts: ['Deployment', 'StatefulSet', 'Pod'] 
      }
    ],
    inputs: [
      { 
        type: 'storage', 
        color: connectionTypes.storage.color, 
        label: 'Backed by',
        from: ['PersistentVolume'] 
      }
    ]
  },
  PersistentVolume: {
    outputs: [
      { 
        type: 'storage', 
        color: connectionTypes.storage.color, 
        label: 'Provides',
        accepts: ['PersistentVolumeClaim'] 
      }
    ]
  },
  ServiceAccount: {
    outputs: [
      { 
        type: 'security', 
        color: connectionTypes.security.color, 
        label: 'Identity for',
        accepts: ['Deployment', 'StatefulSet', 'DaemonSet', 'Pod', 'Job', 'CronJob'] 
      }
    ],
    inputs: [
      { 
        type: 'security', 
        color: connectionTypes.security.color, 
        label: 'Permissions',
        from: ['Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding'] 
      }
    ]
  },
  Role: {
    outputs: [
      { 
        type: 'security', 
        color: connectionTypes.security.color, 
        label: 'Grants',
        accepts: ['ServiceAccount', 'RoleBinding'] 
      }
    ]
  },
  ClusterRole: {
    outputs: [
      { 
        type: 'security', 
        color: connectionTypes.security.color, 
        label: 'Grants',
        accepts: ['ServiceAccount', 'ClusterRoleBinding'] 
      }
    ]
  },
  RoleBinding: {
    inputs: [
      { 
        type: 'security', 
        color: connectionTypes.security.color, 
        label: 'Binds',
        from: ['Role', 'ServiceAccount'] 
      }
    ]
  },
  ClusterRoleBinding: {
    inputs: [
      { 
        type: 'security', 
        color: connectionTypes.security.color, 
        label: 'Binds',
        from: ['ClusterRole', 'ServiceAccount'] 
      }
    ]
  },
  NetworkPolicy: {
    outputs: [
      { 
        type: 'security', 
        color: connectionTypes.security.color, 
        label: 'Restricts',
        accepts: ['Deployment', 'StatefulSet', 'Pod'] 
      }
    ]
  },
  HorizontalPodAutoscaler: {
    outputs: [
      { 
        type: 'scaling', 
        color: connectionTypes.scaling.color, 
        label: 'Scales',
        accepts: ['Deployment', 'StatefulSet', 'ReplicaSet'] 
      }
    ]
  },
  VerticalPodAutoscaler: {
    outputs: [
      { 
        type: 'scaling', 
        color: connectionTypes.scaling.color, 
        label: 'Optimizes',
        accepts: ['Deployment', 'StatefulSet'] 
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
    "Ready to Install": { bg: "bg-blue-50 dark:bg-blue-950/20", text: "text-blue-700 dark:text-blue-400", dot: "bg-blue-500" },
    "Not Deployed": { bg: "bg-gray-50 dark:bg-gray-950/20", text: "text-gray-600 dark:text-gray-400", dot: "bg-gray-400" },
    Pending: { bg: "bg-yellow-50 dark:bg-yellow-950/20", text: "text-yellow-700 dark:text-yellow-400", dot: "bg-yellow-500" },
    NotReady: { bg: "bg-yellow-50 dark:bg-yellow-950/20", text: "text-yellow-700 dark:text-yellow-400", dot: "bg-yellow-500" },
    Failed: { bg: "bg-red-50 dark:bg-red-950/20", text: "text-red-700 dark:text-red-400", dot: "bg-red-500" },
    Error: { bg: "bg-red-50 dark:bg-red-950/20", text: "text-red-700 dark:text-red-400", dot: "bg-red-500" },
    CrashLoopBackOff: { bg: "bg-red-50 dark:bg-red-950/20", text: "text-red-700 dark:text-red-400", dot: "bg-red-500" },
    Completed: { bg: "bg-blue-50 dark:bg-blue-950/20", text: "text-blue-700 dark:text-blue-400", dot: "bg-blue-500" },
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

          {/* Helm-specific fields */}
          {data.kind === 'HelmRelease' && data.chart && (
            <>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Chart
                </label>
                <div className="px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-300">
                  {data.chart.repository}/{data.chart.name}
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Version
                </label>
                <input
                  type="text"
                  value={data.chartVersion || 'latest'}
                  onChange={(e) => handleFieldChange('chartVersion', e.target.value)}
                  placeholder="latest"
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Description
                </label>
                <div className="px-2 py-1 text-xs text-gray-400 leading-relaxed">
                  {data.chart.description || 'No description'}
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Custom Values (YAML)
                </label>
                <textarea
                  value={data.valuesYaml || ''}
                  onChange={(e) => handleFieldChange('valuesYaml', e.target.value)}
                  placeholder="replicaCount: 3&#10;service:&#10;  type: LoadBalancer"
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                  rows={4}
                />
              </div>
            </>
          )}

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
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Container Port
                </label>
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={data.containerPort || 80}
                  onChange={(e) => handleFieldChange('containerPort', parseInt(e.target.value) || 80)}
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          {/* StatefulSet-specific fields */}
          {data.kind === 'StatefulSet' && (
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
                  placeholder="postgres:14"
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Service Name
                </label>
                <input
                  type="text"
                  value={data.serviceName || ''}
                  onChange={(e) => handleFieldChange('serviceName', e.target.value)}
                  placeholder="headless-service"
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          {/* Service-specific fields */}
          {data.kind === 'Service' && (
            <>
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
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Target Port
                </label>
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={data.targetPort || data.port || 80}
                  onChange={(e) => handleFieldChange('targetPort', parseInt(e.target.value) || 80)}
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Type
                </label>
                <select
                  value={data.serviceType || 'ClusterIP'}
                  onChange={(e) => handleFieldChange('serviceType', e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ClusterIP">ClusterIP</option>
                  <option value="NodePort">NodePort</option>
                  <option value="LoadBalancer">LoadBalancer</option>
                  <option value="ExternalName">ExternalName</option>
                </select>
              </div>
            </>
          )}

          {/* Ingress-specific fields */}
          {data.kind === 'Ingress' && (
            <>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Host
                </label>
                <input
                  type="text"
                  value={data.host || ''}
                  onChange={(e) => handleFieldChange('host', e.target.value)}
                  placeholder="example.com"
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Path
                </label>
                <input
                  type="text"
                  value={data.path || '/'}
                  onChange={(e) => handleFieldChange('path', e.target.value)}
                  placeholder="/"
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  TLS Enabled
                </label>
                <input
                  type="checkbox"
                  checked={data.tlsEnabled || false}
                  onChange={(e) => handleFieldChange('tlsEnabled', e.target.checked)}
                  className="w-4 h-4 border border-neutral-700 rounded bg-neutral-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          {/* ConfigMap-specific fields */}
          {data.kind === 'ConfigMap' && (
            <div>
              <label className="block text-[10px] font-medium text-gray-400 mb-1">
                Data (Key=Value pairs)
              </label>
              <textarea
                value={data.configData || ''}
                onChange={(e) => handleFieldChange('configData', e.target.value)}
                placeholder="KEY1=value1&#10;KEY2=value2"
                className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                rows={3}
              />
            </div>
          )}

          {/* Secret-specific fields */}
          {data.kind === 'Secret' && (
            <>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Type
                </label>
                <select
                  value={data.secretType || 'Opaque'}
                  onChange={(e) => handleFieldChange('secretType', e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="Opaque">Opaque</option>
                  <option value="kubernetes.io/tls">TLS</option>
                  <option value="kubernetes.io/dockerconfigjson">Docker Config</option>
                  <option value="kubernetes.io/basic-auth">Basic Auth</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Data (Key=Value pairs)
                </label>
                <textarea
                  value={data.secretData || ''}
                  onChange={(e) => handleFieldChange('secretData', e.target.value)}
                  placeholder="username=admin&#10;password=secret"
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                  rows={3}
                />
              </div>
            </>
          )}

          {/* PVC-specific fields */}
          {data.kind === 'PersistentVolumeClaim' && (
            <>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Storage Size
                </label>
                <input
                  type="text"
                  value={data.storageSize || '10Gi'}
                  onChange={(e) => handleFieldChange('storageSize', e.target.value)}
                  placeholder="10Gi"
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Access Mode
                </label>
                <select
                  value={data.accessMode || 'ReadWriteOnce'}
                  onChange={(e) => handleFieldChange('accessMode', e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ReadWriteOnce">ReadWriteOnce</option>
                  <option value="ReadOnlyMany">ReadOnlyMany</option>
                  <option value="ReadWriteMany">ReadWriteMany</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Storage Class
                </label>
                <input
                  type="text"
                  value={data.storageClass || ''}
                  onChange={(e) => handleFieldChange('storageClass', e.target.value)}
                  placeholder="standard"
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          {/* HPA-specific fields */}
          {data.kind === 'HorizontalPodAutoscaler' && (
            <>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Min Replicas
                </label>
                <input
                  type="number"
                  min="1"
                  value={data.minReplicas || 1}
                  onChange={(e) => handleFieldChange('minReplicas', parseInt(e.target.value) || 1)}
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Max Replicas
                </label>
                <input
                  type="number"
                  min="1"
                  value={data.maxReplicas || 10}
                  onChange={(e) => handleFieldChange('maxReplicas', parseInt(e.target.value) || 10)}
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-gray-400 mb-1">
                  Target CPU %
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={data.targetCPU || 80}
                  onChange={(e) => handleFieldChange('targetCPU', parseInt(e.target.value) || 80)}
                  className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          {/* CRD generic spec editor */}
          {!['Deployment', 'StatefulSet', 'Service', 'Ingress', 'ConfigMap', 'Secret', 'HelmRelease', 'PersistentVolumeClaim', 'HorizontalPodAutoscaler', 'VerticalPodAutoscaler'].includes(data.kind) && (
            <div>
              <label className="block text-[10px] font-medium text-gray-400 mb-1">
                Spec (YAML)
              </label>
              <textarea
                value={data.spec || ''}
                onChange={(e) => handleFieldChange('spec', e.target.value)}
                placeholder="Enter resource spec in YAML format"
                className="w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                rows={6}
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
          {data.kind === 'HelmRelease' && data.chart && (
            <div className="text-[10px] text-gray-400">
              {data.chart.repository}/{data.chart.name}
            </div>
          )}
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
