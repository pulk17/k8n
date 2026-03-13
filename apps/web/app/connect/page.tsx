"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Server, CheckCircle2, AlertCircle } from "lucide-react";
import { fetchContexts, connectToContext } from "../../lib/api";

export default function ConnectPage() {
  const router = useRouter();
  const [contexts, setContexts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedContext, setSelectedContext] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchContexts()
      .then((data) => {
        setContexts(data || []);
        if (data && data.length > 0) {
          setSelectedContext(data[0]);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleConnect = async () => {
    if (!selectedContext) return;
    setConnecting(true);
    setError("");

    try {
      await connectToContext(selectedContext);
      router.push("/canvas");
    } catch (err: any) {
      setError(err.message);
      setConnecting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-neutral-950 p-4">
      <div className="max-w-md w-full">
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-500 rounded-lg mb-4">
            <Server className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            k8n
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Visual Kubernetes IDE
          </p>
        </div>

        {/* Connection Card */}
        <div className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800">
          <div className="bg-gray-50 dark:bg-neutral-800 px-4 py-3 border-b border-gray-200 dark:border-neutral-700">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Connect to Cluster</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Select a Kubernetes context</p>
          </div>

          <div className="p-4 space-y-4">
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-red-700 dark:text-red-300">
                    Connection Failed
                  </div>
                  <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                    {error}
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Kubeconfig Context
              </label>
              {loading ? (
                <div className="h-10 border border-gray-300 dark:border-neutral-700 rounded flex items-center justify-center bg-gray-50 dark:bg-neutral-800">
                  <Loader2 className="w-4 h-4 text-gray-400 animate-spin mr-2" />
                  <span className="text-sm text-gray-500">Loading contexts...</span>
                </div>
              ) : contexts.length === 0 ? (
                <div className="p-3 border-2 border-dashed border-gray-300 dark:border-neutral-700 rounded text-center">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    No Kubernetes contexts found
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                    Make sure kubectl is configured
                  </p>
                </div>
              ) : (
                <select
                  className="w-full h-10 px-3 text-sm border border-gray-300 dark:border-neutral-700 rounded bg-white dark:bg-neutral-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={selectedContext}
                  onChange={(e) => setSelectedContext(e.target.value)}
                  disabled={connecting}
                >
                  {contexts.map((ctx) => (
                    <option key={ctx} value={ctx}>{ctx}</option>
                  ))}
                </select>
              )}
            </div>

            <button
              onClick={handleConnect}
              disabled={!selectedContext || connecting || loading}
              className="w-full h-10 flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Connect to Cluster
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-4">
          <p className="text-xs text-gray-400">
            Powered by React Flow • Kubernetes • Go
          </p>
        </div>
      </div>
    </div>
  );
}
