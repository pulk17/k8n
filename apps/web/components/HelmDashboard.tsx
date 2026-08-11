'use client';

import { useState } from "react";
import { PackageSearch, Search, X, Download } from "lucide-react";
import { HelmChart, searchHelmCharts } from "../lib/api";
import { notifyError } from "../lib/dialog";

export default function HelmDashboard() {
  const [query, setQuery] = useState("");
  const [charts, setCharts] = useState<HelmChart[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      setCharts(await searchHelmCharts(query));
    } catch (err) {
      setCharts([]);
      // Searching goes out to Artifact Hub, so this fails when the backend is
      // down *or* when the machine has no internet.
      notifyError(
        `Chart search failed: ${err instanceof Error ? err.message : err}. ` +
          `Artifact Hub needs internet access.`
      );
    } finally {
      setLoading(false);
    }
  };

  const onDragStart = (event: React.DragEvent<HTMLDivElement>, chart: HelmChart) => {
    event.dataTransfer.setData("application/reactflow", "k8sNode");
    event.dataTransfer.setData("application/k8sKind", "HelmRelease");
    event.dataTransfer.setData("application/helmChart", JSON.stringify(chart));
    event.dataTransfer.effectAllowed = "move";
  };

  if (!open) {
    return (
      <button 
        onClick={() => setOpen(true)}
        className="absolute bottom-4 left-[292px] z-10 flex items-center gap-2 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-gray-300 transition-colors hover:bg-neutral-800"
        title="Search and add Helm charts from Artifact Hub"
      >
        <PackageSearch className="h-4 w-4" />
        <span className="text-xs font-medium">Helm Charts</span>
      </button>
    );
  }

  return (
    <div className="absolute bottom-16 left-[292px] z-20 w-96 max-h-[70vh] bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 shadow-lg rounded overflow-hidden flex flex-col">
      <div className="flex-shrink-0 bg-gray-50 dark:bg-neutral-800 border-b border-gray-200 dark:border-neutral-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PackageSearch className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Artifact Hub</h2>
        </div>
        <button 
          onClick={() => setOpen(false)} 
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-shrink-0 p-3 border-b border-gray-200 dark:border-neutral-800">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input 
            type="text" 
            value={query} 
            onChange={e => setQuery(e.target.value)}
            placeholder="Search Helm charts..." 
            className="flex-1 text-sm bg-white dark:bg-neutral-800 border border-gray-300 dark:border-neutral-700 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button 
            type="submit" 
            className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 transition-colors flex items-center gap-2"
          >
            <Search className="w-4 h-4" />
          </button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
        {loading ? (
          <div className="text-center text-sm text-gray-500 py-8 italic">Searching Artifact Hub...</div>
        ) : charts.length === 0 ? (
          <div className="text-center text-sm text-gray-500 py-8">
            {query ? (
              <div>
                <p className="mb-2">No charts found for &quot;{query}&quot;</p>
                <p className="text-xs">Try searching for: nginx, redis, postgresql, mongodb</p>
              </div>
            ) : (
              <div>
                <p className="mb-2">Enter a search term to find Helm charts</p>
                <p className="text-xs text-gray-400">Popular: nginx, redis, postgresql, mongodb, prometheus</p>
              </div>
            )}
          </div>
        ) : (
          charts.map((chart) => (
            <div
              key={`${chart.repository?.name}/${chart.name}`}
              className="group border border-gray-200 dark:border-neutral-800 rounded p-3 hover:border-blue-300 dark:hover:border-blue-700 bg-white dark:bg-neutral-900 transition-colors cursor-grab active:cursor-grabbing"
              draggable
              onDragStart={(e) => onDragStart(e, chart)}
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate pr-2 flex-1">
                  {chart.name}
                </h3>
                <Download className="w-4 h-4 text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 leading-relaxed mb-2">
                {chart.description}
              </p>
              {chart.repository?.name && (
                <div className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 dark:bg-blue-900/30 rounded">
                  <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400">
                    {chart.repository.name}
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      
      <div className="flex-shrink-0 bg-gray-50 dark:bg-neutral-900/50 px-4 py-2 border-t border-gray-200 dark:border-neutral-800">
        <p className="text-[10px] text-gray-500 dark:text-gray-400 text-center">
          Drag charts to canvas to configure and deploy
        </p>
      </div>
    </div>
  );
}
