'use client';

import { useEffect, useState } from 'react';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { API_URL } from '../lib/api';

interface MetricsData {
  timestamp: number;
  cpu: number;
  memory: number;
}

interface ResourceMonitoringProps {
  resourceName: string;
  resourceKind: string;
  namespace: string;
}

export default function ResourceMonitoringDashboard({ resourceName, resourceKind, namespace }: ResourceMonitoringProps) {
  const [metrics, setMetrics] = useState<MetricsData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [metricsServerAvailable, setMetricsServerAvailable] = useState<boolean | null>(null);

  const checkMetricsServer = async () => {
    try {
      const response = await fetch(
        `${API_URL}/api/metrics/check`
      );
      const data = await response.json();
      setMetricsServerAvailable(data.available);
      if (!data.available) {
        setError(data.hint || 'Metrics-server is not available');
      }
    } catch (err) {
      setMetricsServerAvailable(false);
      setError('Failed to check metrics-server availability');
    }
  };

  const fetchMetrics = async () => {
    try {
      const response = await fetch(
        `${API_URL}/api/metrics/${namespace}/${resourceKind}/${resourceName}`
      );
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.hint || 'Failed to fetch metrics';
        
        // Don't throw for "No metrics found" - just set error state
        setError(errorMessage);
        setLoading(false);
        return;
      }

      const data = await response.json();
      
      setMetrics(prev => {
        const newMetrics = [...prev, {
          timestamp: Date.now(),
          cpu: data.cpu || 0,
          memory: data.memory || 0,
        }];
        
        // Keep only last 20 data points
        return newMetrics.slice(-20);
      });
      
      setError(null);
    } catch (err: any) {
      console.error('Metrics fetch error:', err);
      setError(err.message || 'Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkMetricsServer();
    fetchMetrics();
    
    if (autoRefresh) {
      const interval = setInterval(fetchMetrics, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, resourceName, namespace]);

  const getTrend = (current: number, previous: number) => {
    if (current > previous) return 'up';
    if (current < previous) return 'down';
    return 'stable';
  };

  const getTrendIcon = (trend: string) => {
    if (trend === 'up') return <TrendingUp className="w-3 h-3 text-red-500" />;
    if (trend === 'down') return <TrendingDown className="w-3 h-3 text-green-500" />;
    return <Minus className="w-3 h-3 text-gray-500" />;
  };

  const currentMetrics = metrics[metrics.length - 1];
  const previousMetrics = metrics[metrics.length - 2];
  
  const cpuTrend = previousMetrics ? getTrend(currentMetrics?.cpu || 0, previousMetrics.cpu) : 'stable';
  const memoryTrend = previousMetrics ? getTrend(currentMetrics?.memory || 0, previousMetrics.memory) : 'stable';

  const maxCpu = Math.max(...metrics.map(m => m.cpu), 100);
  const maxMemory = Math.max(...metrics.map(m => m.memory), 100);

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-500" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Resource Monitoring
          </h3>
        </div>
        
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh (5s)
          </label>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded text-sm text-yellow-700 dark:text-yellow-400">
          <div className="font-semibold mb-1">⚠️ {error}</div>
          <div className="text-xs mt-2 space-y-1">
            <div>Common causes:</div>
            <ul className="list-disc list-inside ml-2">
              <li>Metrics-server not installed in cluster</li>
              <li>Pods just started (wait 15-30 seconds for metrics)</li>
              <li>No running pods for this resource</li>
            </ul>
            <div className="mt-2">
              To install metrics-server:
              <code className="block mt-1 p-2 bg-black/20 rounded font-mono text-xs">
                kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
              </code>
            </div>
          </div>
        </div>
      )}

      {/* Current Metrics */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">CPU Usage</span>
            {getTrendIcon(cpuTrend)}
          </div>
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {currentMetrics ? `${currentMetrics.cpu.toFixed(1)}%` : '--'}
          </div>
        </div>

        <div className="p-4 bg-purple-50 dark:bg-purple-950/20 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Memory Usage</span>
            {getTrendIcon(memoryTrend)}
          </div>
          <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
            {currentMetrics ? `${currentMetrics.memory.toFixed(1)} MB` : '--'}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="space-y-6">
        {/* CPU Chart */}
        <div>
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">CPU History</div>
          <div className="h-32 flex items-end gap-1">
            {metrics.map((metric, idx) => (
              <div
                key={idx}
                className="flex-1 bg-blue-500 dark:bg-blue-600 rounded-t transition-all hover:bg-blue-600 dark:hover:bg-blue-500"
                style={{ height: `${(metric.cpu / maxCpu) * 100}%`, minHeight: '2px' }}
                title={`${metric.cpu.toFixed(1)}% at ${new Date(metric.timestamp).toLocaleTimeString()}`}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
            <span>0%</span>
            <span>{maxCpu.toFixed(0)}%</span>
          </div>
        </div>

        {/* Memory Chart */}
        <div>
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Memory History</div>
          <div className="h-32 flex items-end gap-1">
            {metrics.map((metric, idx) => (
              <div
                key={idx}
                className="flex-1 bg-purple-500 dark:bg-purple-600 rounded-t transition-all hover:bg-purple-600 dark:hover:bg-purple-500"
                style={{ height: `${(metric.memory / maxMemory) * 100}%`, minHeight: '2px' }}
                title={`${metric.memory.toFixed(1)} MB at ${new Date(metric.timestamp).toLocaleTimeString()}`}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
            <span>0 MB</span>
            <span>{maxMemory.toFixed(0)} MB</span>
          </div>
        </div>
      </div>

      {loading && metrics.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          Loading metrics...
        </div>
      )}
    </div>
  );
}
