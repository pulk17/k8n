'use client';

import { useState } from "react";
import { PackageSearch, Search, X, Download } from "lucide-react";
import { fetchHelmCharts, API_URL } from "../lib/api";

export default function HelmDashboard() {
  const [query, setQuery] = useState("");
  const [charts, setCharts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;
    
    setLoading(true);
    try {
      const results = await fetchHelmCharts(query);
      setCharts(results || []);
      if (!results || results.length === 0) {
        console.log('No charts found for query:', query);
      }
    } catch (err: any) {
      console.error('Helm search error:', err);
      setCharts([]);
      
      // More detailed error message
      const apiUrl = API_URL;
      alert(
        `❌ Failed to search Helm charts\n\n` +
        `Error: ${err.message}\n\n` +
        `Troubleshooting:\n` +
        `1. Check backend is running: ${apiUrl}/health\n` +
        `2. Verify internet connection (needs Artifact Hub access)\n` +
        `3. Check browser console for detailed errors\n` +
        `4. Try restarting the frontend dev server`
      );
    } finally {
      setLoading(false);
    }
  };

  const onDragStart = (event: React.DragEvent<HTMLDivElement>, chart: any) => {
    event.dataTransfer.setData("application/reactflow", "k8sNode");
    event.dataTransfer.setData("application/k8sKind", "HelmRelease");
    event.dataTransfer.setData("application/helmChart", JSON.stringify(chart));
    event.dataTransfer.effectAllowed = "move";
  };

  if (!open) {
    return (
      <button 
        onClick={() => setOpen(true)}
        className="absolute bottom-14 left-4 z-10 bg-pink-600 hover:bg-pink-700 shadow-lg rounded p-2 px-4 flex items-center gap-2 transition-colors"
        title="Search and add Helm charts from Artifact Hub"
      >
        <PackageSearch className="w-4 h-4 text-white" />
        <span className="text-xs font-semibold text-white">Helm Charts</span>
      </button>
    );
  }

  return (
    <div className="absolute bottom-14 left-4 z-20 w-96 max-h-[70vh] bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 shadow-lg rounded overflow-hidden flex flex-col">
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
                <p className="mb-2">No charts found for "{query}"</p>
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
          charts.map((chart, idx) => (
            <div 
              key={idx} 
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
