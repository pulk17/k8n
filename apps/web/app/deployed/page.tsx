"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, Box, Globe, FileCode, Lock, Network, Database, Briefcase, Clock, Layers, ExternalLink, Trash2, Activity } from "lucide-react";
import Link from "next/link";
import { fetchResources, API_URL } from "../../lib/api";
import { RESOURCE_COLORS, DEFAULT_RESOURCE_COLOR } from "../../lib/constants";
import ApiConnectionError from "../../components/ApiConnectionError";
import ResourceMonitoringDashboard from "../../components/ResourceMonitoringDashboard";

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
};



export default function DeployedPage() {
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNamespace, setSelectedNamespace] = useState<string>("all");
  const [deletingResource, setDeletingResource] = useState<string | null>(null);
  const [hideProtected, setHideProtected] = useState(true);
  const [expandedResources, setExpandedResources] = useState<Record<string, boolean>>({});
  const [monitoringResource, setMonitoringResource] = useState<{name: string; kind: string; namespace: string} | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);

  // Protected resources that shouldn't be deleted
  const protectedResources = [
    'kubernetes',
    'kube-apiserver',
    'kube-controller-manager',
    'kube-scheduler',
    'kube-proxy',
    'coredns',
    'etcd',
    'local-path-provisioner',
    'metrics-server',
    'kube-root-ca.crt',
  ];

  const protectedNamespaces = [
    'kube-system',
    'kube-public',
    'kube-node-lease',
    'local-path-storage',
  ];

  const isProtected = (name: string, namespace: string) => {
    // Protect entire namespaces
    if (protectedNamespaces.includes(namespace)) {
      return true;
    }
    // Protect specific resources by name
    return protectedResources.some(p => name.includes(p));
  };

  const handleDelete = async (resource: any, force: boolean = false) => {
    if (!force && isProtected(resource.name, resource.namespace)) {
      alert('This is a system resource and cannot be deleted.');
      return;
    }

    const confirmMessage = force 
      ? `FORCE DELETE ${resource.kind} "${resource.name}" in namespace "${resource.namespace}"?\n\nThis will bypass finalizers and force removal. This action cannot be undone.`
      : `Delete ${resource.kind} "${resource.name}" in namespace "${resource.namespace}"?\n\nThis action cannot be undone.`;

    if (!confirm(confirmMessage)) {
      return;
    }

    setDeletingResource(resource.uid);
    try {
      const url = force 
        ? `${API_URL}/api/resource/delete?force=true`
        : `${API_URL}/api/resource/delete`;
      
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: resource.kind,
          name: resource.name,
          namespace: resource.namespace,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete resource');
      }

      // Reload resources
      await loadResources();
    } catch (err: any) {
      alert(`Failed to delete resource: ${err.message}`);
    } finally {
      setDeletingResource(null);
    }
  };

  const handleDeleteAll = async (force: boolean = false) => {
    const resourcesToDelete = hideProtected 
      ? filteredResources 
      : filteredResources.filter(r => !isProtected(r.name, r.namespace));

    if (resourcesToDelete.length === 0) {
      alert('No resources to delete');
      return;
    }

    const confirmMessage = force
      ? `FORCE DELETE ALL ${resourcesToDelete.length} resources?\n\nThis will bypass finalizers and force removal. This action cannot be undone.`
      : `Delete all ${resourcesToDelete.length} resources?\n\nThis action cannot be undone.`;

    if (!confirm(confirmMessage)) {
      return;
    }

    setDeletingAll(true);
    let successCount = 0;
    let failCount = 0;

    for (const resource of resourcesToDelete) {
      try {
        const url = force 
          ? `${API_URL}/api/resource/delete?force=true`
          : `${API_URL}/api/resource/delete`;
        
        const response = await fetch(url, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: resource.kind,
            name: resource.name,
            namespace: resource.namespace,
          }),
        });

        if (response.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        failCount++;
      }
    }

    setDeletingAll(false);
    alert(`Deleted ${successCount} resources.\n${failCount > 0 ? `Failed to delete ${failCount} resources.` : ''}`);
    await loadResources();
  };

  const loadResources = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchResources();
      setResources(data);
    } catch (err: any) {
      console.error('Failed to fetch resources:', err);
      setError(err.message || 'Failed to fetch resources');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadResources();
  }, []);

  // Show API connection error if it's a connection issue
  if (error && error.includes('Cannot connect to API server')) {
    return <ApiConnectionError error={error} onRetry={loadResources} />;
  }

  const namespaces = Array.from(new Set((resources || []).map(r => r.namespace).filter(Boolean)));
  
  // Filter by namespace
  let filteredResources = selectedNamespace === "all" 
    ? (resources || [])
    : (resources || []).filter(r => r.namespace === selectedNamespace);
  
  // Filter out protected resources if hideProtected is true
  if (hideProtected) {
    filteredResources = filteredResources.filter(r => !isProtected(r.name, r.namespace));
  }

  const groupedByKind = filteredResources.reduce((acc, resource) => {
    if (!acc[resource.kind]) {
      acc[resource.kind] = [];
    }
    acc[resource.kind].push(resource);
    return acc;
  }, {} as Record<string, any[]>);

  const statusColors: Record<string, { bg: string; text: string; dot: string }> = {
    Running: { bg: "bg-green-50 dark:bg-green-950/20", text: "text-green-700 dark:text-green-400", dot: "bg-green-500" },
    Ready: { bg: "bg-green-50 dark:bg-green-950/20", text: "text-green-700 dark:text-green-400", dot: "bg-green-500" },
    Active: { bg: "bg-green-50 dark:bg-green-950/20", text: "text-green-700 dark:text-green-400", dot: "bg-green-500" },
    Completed: { bg: "bg-blue-50 dark:bg-blue-950/20", text: "text-blue-700 dark:text-blue-400", dot: "bg-blue-500" },
    Succeeded: { bg: "bg-blue-50 dark:bg-blue-950/20", text: "text-blue-700 dark:text-blue-400", dot: "bg-blue-500" },
    "Not Deployed": { bg: "bg-gray-50 dark:bg-gray-950/20", text: "text-gray-600 dark:text-gray-400", dot: "bg-gray-400" },
    Pending: { bg: "bg-yellow-50 dark:bg-yellow-950/20", text: "text-yellow-700 dark:text-yellow-400", dot: "bg-yellow-500" },
    NotReady: { bg: "bg-yellow-50 dark:bg-yellow-950/20", text: "text-yellow-700 dark:text-yellow-400", dot: "bg-yellow-500" },
    Failed: { bg: "bg-red-50 dark:bg-red-950/20", text: "text-red-700 dark:text-red-400", dot: "bg-red-500" },
    Error: { bg: "bg-red-50 dark:bg-red-950/20", text: "text-red-700 dark:text-red-400", dot: "bg-red-500" },
    CrashLoopBackOff: { bg: "bg-red-50 dark:bg-red-950/20", text: "text-red-700 dark:text-red-400", dot: "bg-red-500" },
    Unknown: { bg: "bg-gray-50 dark:bg-gray-950/20", text: "text-gray-600 dark:text-gray-400", dot: "bg-gray-400" },
  };

  return (
    <div className="h-screen bg-gray-50 dark:bg-neutral-950 overflow-y-scroll" style={{ scrollbarWidth: 'thin', scrollbarColor: '#4b5563 #1f2937' }}>
      <div className="max-w-7xl mx-auto p-8 pb-24">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <Link 
              href="/canvas" 
              className="inline-flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Canvas
            </Link>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Deployed Resources
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              View all resources currently deployed in your cluster
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={loadResources}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            
            <button
              onClick={() => handleDeleteAll(false)}
              disabled={deletingAll || filteredResources.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50"
              title="Delete all non-protected resources"
            >
              <Trash2 className="w-4 h-4" />
              Delete All
            </button>
            
            <button
              onClick={() => handleDeleteAll(true)}
              disabled={deletingAll || filteredResources.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded transition-colors disabled:opacity-50"
              title="Force delete all resources (including protected)"
            >
              <Trash2 className="w-4 h-4" />
              Force Delete All
            </button>
          </div>
        </div>

        {/* Namespace Filter */}
        <div className="mb-6 flex items-center gap-3 flex-wrap">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Namespace:
          </label>
          <select
            value={selectedNamespace}
            onChange={(e) => setSelectedNamespace(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-neutral-700 rounded bg-white dark:bg-neutral-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Namespaces</option>
            {namespaces.map(ns => (
              <option key={ns} value={ns}>{ns}</option>
            ))}
          </select>
          
          {/* Hide Protected Toggle */}
          <div className="flex items-center gap-2 ml-4">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={hideProtected}
                onChange={(e) => setHideProtected(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
              <span className="ml-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                Hide Protected Resources
              </span>
            </label>
          </div>
          
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {filteredResources.length} resources
          </span>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-2" />
            <p className="text-gray-600 dark:text-gray-400">Loading resources...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded p-4 mb-6">
            <p className="text-red-700 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Resources Grid */}
        {!loading && !error && (
          <div className="space-y-6">
            {Object.entries(groupedByKind).map(([kind, items]) => {
              const Icon = iconMap[kind] || Box;
              const color = RESOURCE_COLORS[kind] || DEFAULT_RESOURCE_COLOR;
              const resourceItems = items as any[];
              
              return (
                <div key={kind} className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800 overflow-hidden">
                  <div 
                    className="px-4 py-3 border-b border-gray-200 dark:border-neutral-800 flex items-center gap-3"
                    style={{ backgroundColor: `${color}10` }}
                  >
                    <Icon className="w-5 h-5" style={{ color }} />
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {kind}
                    </h2>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      ({resourceItems.length})
                    </span>
                  </div>
                  
                  <div className="divide-y divide-gray-200 dark:divide-neutral-800">
                    {resourceItems.map((resource: any, idx: number) => {
                      const statusStyle = statusColors[resource.status] || statusColors.Unknown;
                      const expanded = expandedResources[resource.uid] || false;
                      const toggleExpanded = () => {
                        setExpandedResources(prev => ({
                          ...prev,
                          [resource.uid]: !prev[resource.uid]
                        }));
                      };
                      
                      return (
                        <div key={resource.uid || idx} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              {/* Header - Always Visible */}
                              <div 
                                className="flex items-center flex-wrap gap-2 mb-2 cursor-pointer"
                                onClick={toggleExpanded}
                              >
                                <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                                  {expanded ? '▼' : '▶'}
                                </button>
                                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                                  {resource.name}
                                </h3>
                                <span className="text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-neutral-800 px-2 py-0.5 rounded">
                                  {resource.namespace}
                                </span>
                                {resource.createdAt && (
                                  <span className="text-xs text-gray-400 dark:text-gray-500">
                                    {resource.createdAt}
                                  </span>
                                )}
                              </div>
                              
                              {/* Expandable Details */}
                              {expanded && (
                                <>
                                  {/* Resource-specific details */}
                                  <div className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400 mb-2 pl-4 border-l-2 border-gray-200 dark:border-neutral-700">
                                    {/* Deployment/StatefulSet info */}
                                    {resource.replicas !== undefined && (
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-500 dark:text-gray-500 min-w-[80px]">Replicas:</span>
                                        <span className="font-medium">
                                          {resource.readyReplicas || 0}/{resource.replicas}
                                        </span>
                                      </div>
                                    )}
                                    
                                    {/* Image */}
                                    {resource.image && (
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-500 dark:text-gray-500 min-w-[80px]">Image:</span>
                                        <span className="font-mono text-xs break-all">{resource.image}</span>
                                      </div>
                                    )}
                                    
                                    {/* Pod-specific info */}
                                    {resource.kind === 'Pod' && (
                                      <>
                                        {resource.podIP && (
                                          <div className="flex items-center gap-2">
                                            <span className="text-gray-500 dark:text-gray-500 min-w-[80px]">Pod IP:</span>
                                            <span className="font-mono">{resource.podIP}</span>
                                          </div>
                                        )}
                                        {resource.nodeName && (
                                          <div className="flex items-center gap-2">
                                            <span className="text-gray-500 dark:text-gray-500 min-w-[80px]">Node:</span>
                                            <span className="font-mono break-all">{resource.nodeName}</span>
                                          </div>
                                        )}
                                        {resource.restartCount !== undefined && (
                                          <div className="flex items-center gap-2">
                                            <span className="text-gray-500 dark:text-gray-500 min-w-[80px]">Restarts:</span>
                                            <span className={resource.restartCount > 0 ? "text-yellow-600 dark:text-yellow-400 font-medium" : ""}>
                                              {resource.restartCount}
                                            </span>
                                          </div>
                                        )}
                                        {resource.ownerReferences && resource.ownerReferences.length > 0 && (
                                          <div className="flex items-center gap-2">
                                            <span className="text-gray-500 dark:text-gray-500 min-w-[80px]">Owner:</span>
                                            <span className="font-mono text-xs break-all">{resource.ownerReferences[0]}</span>
                                          </div>
                                        )}
                                      </>
                                    )}
                                    
                                    {/* Service-specific info */}
                                    {resource.kind === 'Service' && (
                                      <>
                                        {resource.serviceType && (
                                          <div className="flex items-center gap-2">
                                            <span className="text-gray-500 dark:text-gray-500 min-w-[80px]">Type:</span>
                                            <span className="font-medium">{resource.serviceType}</span>
                                          </div>
                                        )}
                                        {resource.clusterIP && (
                                          <div className="flex items-center gap-2">
                                            <span className="text-gray-500 dark:text-gray-500 min-w-[80px]">Cluster IP:</span>
                                            <span className="font-mono">{resource.clusterIP}</span>
                                          </div>
                                        )}
                                        {resource.externalIP && (
                                          <div className="flex items-center gap-2">
                                            <span className="text-gray-500 dark:text-gray-500 min-w-[80px]">External IP:</span>
                                            <span className="font-mono text-blue-600 dark:text-blue-400">{resource.externalIP}</span>
                                          </div>
                                        )}
                                        {resource.ports && resource.ports.length > 0 && (
                                          <div className="flex items-center gap-2">
                                            <span className="text-gray-500 dark:text-gray-500 min-w-[80px]">Ports:</span>
                                            <span className="font-mono text-xs break-all">{resource.ports.join(', ')}</span>
                                          </div>
                                        )}
                                      </>
                                    )}
                                    
                                    {/* ConfigMap/Secret info */}
                                    {(resource.kind === 'ConfigMap' || resource.kind === 'Secret') && resource.dataKeys && (
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-500 dark:text-gray-500 min-w-[80px]">Keys:</span>
                                        <span className="font-mono text-xs break-all">{resource.dataKeys.join(', ')}</span>
                                      </div>
                                    )}
                                  </div>
                                  
                                  {/* Labels */}
                                  {resource.labels && Object.keys(resource.labels).length > 0 && (
                                    <div className="text-xs mb-2 pl-4">
                                      <div className="flex items-start gap-2 mb-1">
                                        <span className="text-gray-500 dark:text-gray-500 flex-shrink-0 min-w-[80px]">Labels:</span>
                                      </div>
                                      <div className="flex flex-wrap gap-1.5 ml-[88px]">
                                        {Object.entries(resource.labels).slice(0, 4).map(([key, value]: [string, any]) => (
                                          <span 
                                            key={key} 
                                            className="bg-gray-100 dark:bg-neutral-800 px-2 py-1 rounded font-mono text-xs inline-block max-w-full"
                                            title={`${key}=${value}`}
                                          >
                                            <span className="break-all">{key}={value}</span>
                                          </span>
                                        ))}
                                        {Object.keys(resource.labels).length > 4 && (
                                          <span className="text-gray-400 dark:text-gray-500 px-2 py-1 inline-block">
                                            +{Object.keys(resource.labels).length - 4} more
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                              
                              {/* Error/Status Message - Always Visible if Present */}
                              {resource.statusMessage && (resource.status === "Error" || resource.status === "Failed" || resource.status === "NotReady") && (
                                <div className="mt-2 p-2 text-xs bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded">
                                  <div className="flex items-start gap-2">
                                    <span className="text-red-600 dark:text-red-400 font-semibold flex-shrink-0">Error:</span>
                                    <span className="text-red-600 dark:text-red-400 break-words">{resource.statusMessage}</span>
                                  </div>
                                </div>
                              )}
                              
                              {/* Pending message - Only show if not ContainerCreating/PodInitializing */}
                              {resource.status === "Pending" && resource.statusMessage && 
                               !resource.statusMessage.includes("ContainerCreating") && 
                               !resource.statusMessage.includes("PodInitializing") && (
                                <div className="mt-2 p-2 text-xs bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900/30 rounded">
                                  <div className="flex items-start gap-2">
                                    <span className="text-yellow-600 dark:text-yellow-400 font-semibold flex-shrink-0">Info:</span>
                                    <span className="text-yellow-600 dark:text-yellow-400 break-words">{resource.statusMessage}</span>
                                  </div>
                                </div>
                              )}
                              
                              {/* Completed message */}
                              {resource.status === "Completed" && resource.statusMessage && (
                                <div className="mt-2 p-2 text-xs bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/30 rounded">
                                  <div className="flex items-start gap-2">
                                    <span className="text-blue-600 dark:text-blue-400 font-semibold flex-shrink-0">Info:</span>
                                    <span className="text-blue-600 dark:text-blue-400">{resource.statusMessage}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                            
                            <div className="flex items-center gap-3 flex-shrink-0">
                              {/* Monitor Button for Pods and Deployments */}
                              {(resource.kind === 'Pod' || resource.kind === 'Deployment' || resource.kind === 'StatefulSet' || resource.kind === 'DaemonSet') && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMonitoringResource({
                                      name: resource.name,
                                      kind: resource.kind,
                                      namespace: resource.namespace
                                    });
                                  }}
                                  className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/20 rounded transition-colors"
                                  title="Monitor resource"
                                >
                                  <Activity className="w-4 h-4" />
                                </button>
                              )}
                              
                              <div className={`px-3 py-1 ${statusStyle.bg} rounded flex items-center gap-2`}>
                                <div className={`w-2 h-2 rounded-full ${statusStyle.dot}`} />
                                <span className={`text-xs font-medium ${statusStyle.text}`}>
                                  {resource.status}
                                </span>
                              </div>
                              
                              {!isProtected(resource.name, resource.namespace) && (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDelete(resource);
                                    }}
                                    disabled={deletingResource === resource.uid}
                                    className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded transition-colors disabled:opacity-50"
                                    title="Delete resource"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDelete(resource, true);
                                    }}
                                    disabled={deletingResource === resource.uid}
                                    className="p-2 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/20 rounded transition-colors disabled:opacity-50"
                                    title="Force delete (bypass finalizers)"
                                  >
                                    <Trash2 className="w-4 h-4 stroke-2" />
                                  </button>
                                </div>
                              )}
                              
                              {isProtected(resource.name, resource.namespace) && (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDelete(resource, true);
                                    }}
                                    disabled={deletingResource === resource.uid}
                                    className="p-2 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/20 rounded transition-colors disabled:opacity-50"
                                    title="Force delete (protected resource)"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                  <div className="px-2 py-1 bg-gray-100 dark:bg-neutral-800 rounded">
                                    <span className="text-xs text-gray-500 dark:text-gray-400">Protected</span>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && filteredResources.length === 0 && (
          <div className="text-center py-12 bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800">
            <Box className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 dark:text-gray-400 mb-2">No resources found</p>
            <p className="text-sm text-gray-500 dark:text-gray-500">
              Deploy some resources from the canvas to see them here
            </p>
          </div>
        )}

        {/* Monitoring Dashboard */}
        {monitoringResource && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setMonitoringResource(null)}>
            <div className="max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">
                  Monitoring: {monitoringResource.name}
                </h2>
                <button
                  onClick={() => setMonitoringResource(null)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
                >
                  Close
                </button>
              </div>
              <ResourceMonitoringDashboard
                resourceName={monitoringResource.name}
                resourceKind={monitoringResource.kind}
                namespace={monitoringResource.namespace}
              />
            </div>
          </div>
        )}

        {/* Quick Commands */}
        <div className="mt-8 bg-neutral-900 rounded-lg border border-neutral-800 p-6">
          <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
            <ExternalLink className="w-5 h-5" />
            Quick kubectl Commands
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-3">
              <code className="flex-1 text-green-400 font-mono bg-black/50 px-3 py-2 rounded">
                kubectl get all -n {selectedNamespace === 'all' ? 'default' : selectedNamespace}
              </code>
            </div>
            <div className="flex items-center gap-3">
              <code className="flex-1 text-green-400 font-mono bg-black/50 px-3 py-2 rounded">
                kubectl get pods -n {selectedNamespace === 'all' ? 'default' : selectedNamespace} --watch
              </code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
