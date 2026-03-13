"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, Box, Globe, FileCode, Lock, Network, Database, Briefcase, Clock, Layers, ExternalLink, Trash2 } from "lucide-react";
import Link from "next/link";
import { fetchResources } from "../../lib/api";

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

const colorMap: Record<string, string> = {
  Deployment: "#3b82f6",
  Service: "#22c55e",
  Pod: "#6b7280",
  ConfigMap: "#eab308",
  Secret: "#ef4444",
  ReplicaSet: "#8b5cf6",
  StatefulSet: "#06b6d4",
  DaemonSet: "#f59e0b",
  Job: "#10b981",
  CronJob: "#14b8a6",
  Ingress: "#ec4899",
};

export default function DeployedPage() {
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNamespace, setSelectedNamespace] = useState<string>("all");
  const [deletingResource, setDeletingResource] = useState<string | null>(null);

  // Protected resources that shouldn't be deleted
  const protectedResources = [
    'kubernetes',
    'kube-apiserver',
    'kube-controller-manager',
    'kube-scheduler',
    'kube-proxy',
    'coredns',
    'etcd',
  ];

  const isProtected = (name: string, namespace: string) => {
    if (['kube-system', 'kube-public', 'kube-node-lease'].includes(namespace)) {
      return true;
    }
    return protectedResources.some(p => name.includes(p));
  };

  const handleDelete = async (resource: any) => {
    if (isProtected(resource.name, resource.namespace)) {
      alert('This is a system resource and cannot be deleted.');
      return;
    }

    if (!confirm(`Delete ${resource.kind} "${resource.name}" in namespace "${resource.namespace}"?\n\nThis action cannot be undone.`)) {
      return;
    }

    setDeletingResource(resource.uid);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/resource/delete`, {
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

  const loadResources = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchResources();
      setResources(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadResources();
  }, []);

  const namespaces = Array.from(new Set(resources.map(r => r.namespace).filter(Boolean)));
  const filteredResources = selectedNamespace === "all" 
    ? resources 
    : resources.filter(r => r.namespace === selectedNamespace);

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
          
          <button
            onClick={loadResources}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Namespace Filter */}
        <div className="mb-6 flex items-center gap-3">
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
              const color = colorMap[kind] || "#9ca3af";
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
                      
                      return (
                        <div key={idx} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-1">
                                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                                  {resource.name}
                                </h3>
                                <span className="text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-neutral-800 px-2 py-0.5 rounded">
                                  {resource.namespace}
                                </span>
                              </div>
                              
                              {/* Additional Info */}
                              <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
                                {resource.replicas !== undefined && (
                                  <span>Replicas: {resource.replicas}</span>
                                )}
                                {resource.image && (
                                  <span className="font-mono">{resource.image}</span>
                                )}
                                {resource.port && (
                                  <span>Port: {resource.port}</span>
                                )}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-3">
                              <div className={`px-3 py-1 ${statusStyle.bg} rounded flex items-center gap-2`}>
                                <div className={`w-2 h-2 rounded-full ${statusStyle.dot}`} />
                                <span className={`text-xs font-medium ${statusStyle.text}`}>
                                  {resource.status}
                                </span>
                              </div>
                              
                              {!isProtected(resource.name, resource.namespace) && (
                                <button
                                  onClick={() => handleDelete(resource)}
                                  disabled={deletingResource === resource.uid}
                                  className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded transition-colors disabled:opacity-50"
                                  title="Delete resource"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                              
                              {isProtected(resource.name, resource.namespace) && (
                                <div className="px-2 py-1 bg-gray-100 dark:bg-neutral-800 rounded">
                                  <span className="text-xs text-gray-500 dark:text-gray-400">Protected</span>
                                </div>
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
