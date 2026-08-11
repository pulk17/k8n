'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, Activity, Cpu, HardDrive, RefreshCw } from 'lucide-react';
import { errorMessage, fetchPodMetrics } from '../lib/api';

interface ContainerMetrics {
  name: string;
  cpu: string;
  memory: string;
}

interface PodMetrics {
  name: string;
  namespace: string;
  cpu: string;
  memory: string;
  containers: ContainerMetrics[];
}

interface PodMetricsPanelProps {
  podName: string;
  namespace: string;
  onClose: () => void;
}

export default function PodMetricsPanel({ podName, namespace, onClose }: PodMetricsPanelProps) {
  const [metrics, setMetrics] = useState<PodMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setMetrics(await fetchPodMetrics(podName, namespace));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [podName, namespace]);

  useEffect(() => {
    refresh();
    if (!autoRefresh) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh, autoRefresh]);

  return (
    <div className="fixed right-4 top-20 w-96 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50 max-h-[80vh] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 bg-neutral-800/50">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-gray-100">Pod Metrics</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`p-1.5 rounded transition-colors ${
              autoRefresh 
                ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30' 
                : 'bg-neutral-700 text-gray-400 hover:bg-neutral-600'
            }`}
            title={autoRefresh ? 'Auto-refresh enabled' : 'Auto-refresh disabled'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-neutral-700 rounded transition-colors text-gray-400 hover:text-gray-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && !metrics && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded p-3">
            <p className="text-xs text-red-400 font-medium mb-1">Error</p>
            <p className="text-xs text-red-300">{error}</p>
            <p className="text-xs text-gray-400 mt-2">
              Ensure metrics-server is installed in your cluster
            </p>
          </div>
        )}

        {metrics && (
          <>
            {/* Pod Info */}
            <div className="bg-neutral-800/50 rounded p-3 space-y-2">
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Pod Name</p>
                <p className="text-xs text-gray-100 font-mono">{metrics.name}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Namespace</p>
                <p className="text-xs text-gray-100 font-mono">{metrics.namespace}</p>
              </div>
            </div>

            {/* Total Usage */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Total Usage</h4>
              
              {/* CPU */}
              <div className="bg-neutral-800/50 rounded p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Cpu className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-medium text-gray-300">CPU</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-blue-400">{metrics.cpu}</span>
                  <span className="text-xs text-gray-500">cores</span>
                </div>
              </div>

              {/* Memory */}
              <div className="bg-neutral-800/50 rounded p-3">
                <div className="flex items-center gap-2 mb-2">
                  <HardDrive className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-medium text-gray-300">Memory</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-purple-400">{metrics.memory}</span>
                </div>
              </div>
            </div>

            {/* Container Breakdown */}
            {metrics.containers.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
                  Containers ({metrics.containers.length})
                </h4>
                
                {metrics.containers.map((container, idx) => (
                  <div key={idx} className="bg-neutral-800/30 rounded p-3 space-y-2">
                    <p className="text-xs font-medium text-gray-200 font-mono">{container.name}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] text-gray-500 mb-1">CPU</p>
                        <p className="text-sm font-semibold text-blue-400">{container.cpu}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500 mb-1">Memory</p>
                        <p className="text-sm font-semibold text-purple-400">{container.memory}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Refresh Info */}
            <div className="text-center pt-2">
              <p className="text-[10px] text-gray-500">
                {autoRefresh ? 'Auto-refreshing every 5 seconds' : 'Auto-refresh disabled'}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
