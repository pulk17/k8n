'use client';

import { useState } from "react";
import { useCanvasStore } from "../store/canvasStore";
import { compileGraph } from "../lib/compiler";
import { API_URL } from "../lib/api";
import { Play, Save, RefreshCw, AlertCircle, CheckCircle2, Loader2, X, HelpCircle, Eye, FolderOpen } from "lucide-react";

export default function CanvasToolbar() {
  const { nodes, edges, namespaces, activeNamespace, setActiveNamespace, graphName, setGraphName, saveGraph, hydrateGraph } = useCanvasStore();
  const [applying, setApplying] = useState(false);
  const [applyState, setApplyState] = useState<"idle" | "dry-running" | "applying" | "success" | "error">("idle");
  const [errors, setErrors] = useState<{ resource: string; message: string }[]>([]);

  const handleApply = async () => {
    setApplying(true);
    setErrors([]);
    setApplyState("dry-running");

    try {
      const k8sNodes = nodes.filter(n => n.data.kind !== "HelmRelease");
      const helmNodes = nodes.filter(n => n.data.kind === "HelmRelease");

      let yaml = "";
      if (k8sNodes.length > 0) {
        yaml = await compileGraph(k8sNodes, edges);
        if (!yaml && helmNodes.length === 0) {
          throw new Error("Graph compilation resulted in empty YAML.");
        }
      }

      // Dry Run
      if (yaml) {
        const dryRes = await fetch(`${API_URL}/api/graph/apply?dryRun=true`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ yaml }),
        });

        if (!dryRes.ok) {
          const dryData = await dryRes.json();
          setErrors(dryData.errors || [{ resource: "Unknown", message: dryData.error || "Dry-run failed" }]);
          setApplyState("error");
          setApplying(false);
          return;
        }
      }

      setApplyState("applying");

      // Apply K8s Resources
      if (yaml) {
        const applyRes = await fetch(`${API_URL}/api/graph/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ yaml }),
        });

        if (!applyRes.ok) {
          const applyData = await applyRes.json();
          setErrors(applyData.errors || [{ resource: "Unknown", message: applyData.error || "Apply failed" }]);
          setApplyState("error");
          setApplying(false);
          return;
        }
      }

      // Install Helm Charts
      const helmErrors: any[] = [];
      for (const hNode of helmNodes) {
        const installRes = await fetch(`${API_URL}/api/helm/install`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            releaseName: hNode.data.name,
            chartName: hNode.data.chart?.name || "unknown",
            namespace: hNode.data.namespace || "default",
            valuesYaml: hNode.data.valuesYaml || ""
          }),
        });
        if (!installRes.ok) {
          const installData = await installRes.json();
          helmErrors.push({ resource: hNode.data.name, message: installData.error || "Helm Install failed" });
        }
      }

      if (helmErrors.length > 0) {
        setErrors(helmErrors);
        setApplyState("error");
      } else {
        setApplyState("success");
        setTimeout(() => setApplyState("idle"), 3000);
      }
    } catch (err: any) {
      setErrors([{ resource: "Client", message: err.message }]);
      setApplyState("error");
    } finally {
      setApplying(false);
    }
  };

  const handleRefresh = async () => {
    await hydrateGraph();
  };

  return (
    <>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg px-4 py-2 flex items-center gap-3">
        
        {/* Graph Name */}
        <div className="flex items-center gap-2 border-r border-gray-200 dark:border-neutral-700 pr-3">
          <input 
            type="text" 
            value={graphName}
            onChange={(e) => setGraphName(e.target.value)}
            className="text-sm font-medium bg-transparent border-none focus:ring-0 w-32 text-gray-800 dark:text-gray-100 placeholder-gray-400 outline-none"
            placeholder="Graph Name..."
          />
          <button 
            onClick={saveGraph} 
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded transition-colors"
            title="Save Graph"
          >
            <Save className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        {/* Namespace Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Namespace:</span>
          <select 
            className="text-sm bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded px-2 py-1 outline-none focus:border-blue-500"
            value={activeNamespace}
            onChange={(e) => setActiveNamespace(e.target.value)}
          >
            <option value="all">All</option>
            {namespaces.map(ns => (
              <option key={ns} value={ns}>{ns}</option>
            ))}
          </select>
        </div>

        <div className="w-px h-5 bg-gray-200 dark:bg-neutral-700"></div>

        {/* Refresh Button */}
        <button
          onClick={handleRefresh}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded transition-colors"
          title="Refresh from Cluster"
        >
          <RefreshCw className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        </button>

        {/* Apply Button */}
        <button
          onClick={handleApply}
          disabled={applying || nodes.length === 0}
          className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-3 py-1.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {applying ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          {applyState === "dry-running" ? "Validating..." : applyState === "applying" ? "Applying..." : "Apply"}
        </button>

        {/* Success Indicator */}
        {applyState === "success" && (
          <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-xs font-medium">Applied!</span>
          </div>
        )}
      </div>

      {/* Error Panel */}
      {errors.length > 0 && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 w-[500px] max-h-80 overflow-y-auto bg-white dark:bg-neutral-900 border-2 border-red-300 dark:border-red-900/50 rounded-lg z-50">
          <div className="bg-red-50 dark:bg-red-950/30 px-4 py-2 border-b border-red-200 dark:border-red-900/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
              <h4 className="text-sm font-semibold text-red-700 dark:text-red-300">Apply Errors</h4>
            </div>
            <button 
              onClick={() => setErrors([])} 
              className="text-red-400 hover:text-red-600 dark:hover:text-red-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-3 space-y-2">
            {errors.map((e, i) => (
              <div key={i} className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded p-2">
                <div className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1">
                  Resource: {e.resource}
                </div>
                <div className="text-xs text-red-600 dark:text-red-400 font-mono">
                  {e.message}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
