'use client';

import { useEffect, useState } from "react";
import { PackageSearch, Search, X, Star } from "lucide-react";
import { HelmChart, searchHelmCharts } from "../lib/api";
import { notifyError } from "../lib/dialog";
import { usePanel } from "../lib/panel";

/** Long enough that typing a word is one request, short enough to feel live. */
const DEBOUNCE_MS = 300;

/** Artifact Hub search. `onAdd` puts a chart on the canvas, as dropping one does. */
export default function HelmDashboard({ onAdd }: { onAdd: (chart: HelmChart) => void }) {
  const [query, setQuery] = useState("");
  const [charts, setCharts] = useState<HelmChart[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = usePanel("helm-charts");

  /**
   * Searches as you type.
   *
   * It used to need Enter, which made an empty panel look like "no results"
   * rather than "nothing asked yet". Each keystroke restarts the timer, and a
   * reply that arrives after the query moved on is dropped — otherwise a slow
   * search for "pro" lands on top of the results for "prometheus".
   */
  useEffect(() => {
    const term = query.trim();
    // An empty box is not a search. Nothing is set here for that case: the
    // render below reads the query, so there is no state to clear — and this
    // effect never calls setState synchronously.
    if (!term) return;

    let cancelled = false;

    const timer = setTimeout(() => {
      setLoading(true);
      searchHelmCharts(term)
        .then(found => {
          if (cancelled) return;
          setCharts(found);
          setSearched(true);
        })
        .catch(err => {
          if (cancelled) return;
          setCharts([]);
          setSearched(true);
          // Searching goes out to Artifact Hub, so this fails when the backend
          // is down *or* when the machine has no internet.
          notifyError(
            `Chart search failed: ${err instanceof Error ? err.message : err}. ` +
              `Artifact Hub needs internet access.`
          );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // What the list shows is a function of the query: clearing the box empties
  // the results without a round trip, and a pending search for the old term
  // cannot repopulate them.
  const term = query.trim();
  const results = term ? charts : [];
  const searching = Boolean(term) && loading;

  // Dragging was the only way in, which left no path for a keyboard or a
  // trackpad that makes long drags a chore.
  const add = (chart: HelmChart) => {
    onAdd(chart);
    setOpen(false);
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
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search Helm charts..."
            autoFocus
            aria-label="Search Helm charts on Artifact Hub"
            className="w-full rounded border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
        {searching ? (
          <div className="text-center text-sm text-gray-500 py-8 italic">Searching Artifact Hub...</div>
        ) : results.length === 0 ? (
          <div className="text-center text-sm text-gray-500 py-8">
            {term && searched ? (
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
          results.map((chart) => (
            <div
              key={`${chart.repository?.name}/${chart.name}`}
              role="button"
              tabIndex={0}
              title="Click to add, or drag onto the canvas"
              className="group border border-gray-200 dark:border-neutral-800 rounded p-3 hover:border-blue-300 dark:hover:border-blue-700 focus:border-blue-500 focus:outline-none bg-white dark:bg-neutral-900 transition-colors cursor-grab active:cursor-grabbing"
              draggable
              onDragStart={(e) => onDragStart(e, chart)}
              onClick={() => add(chart)}
              onKeyDown={e => e.key === "Enter" && add(chart)}
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate pr-2 flex-1">
                  {chart.name}
                  {chart.app_version && (
                    <span className="ml-1.5 font-mono text-[10px] font-normal text-gray-500">{chart.app_version}</span>
                  )}
                </h3>
                {typeof chart.stars === "number" && chart.stars > 0 && (
                  <span className="flex flex-shrink-0 items-center gap-0.5 text-[10px] text-yellow-500" title="Stars on Artifact Hub">
                    <Star className="h-3 w-3" /> {chart.stars}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 leading-relaxed mb-2">
                {chart.description}
              </p>
              <div className="flex flex-wrap items-center gap-1">
                {chart.repository?.name && (
                  <span className="rounded bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                    {chart.repository.name}
                  </span>
                )}
                {(chart.official || chart.repository?.official) && (
                  <span className="rounded bg-green-950/60 px-2 py-1 text-[10px] font-medium text-green-400" title="Published by the project itself">
                    official
                  </span>
                )}
                {chart.repository?.verified_publisher && (
                  <span className="rounded bg-neutral-800 px-2 py-1 text-[10px] text-gray-300" title="Artifact Hub has verified who publishes this repository">
                    verified publisher
                  </span>
                )}
                {chart.deprecated && (
                  <span className="rounded bg-red-950/60 px-2 py-1 text-[10px] font-medium text-red-400">deprecated</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      
      <div className="flex-shrink-0 bg-gray-50 dark:bg-neutral-900/50 px-4 py-2 border-t border-gray-200 dark:border-neutral-800">
        <p className="text-[10px] text-gray-500 dark:text-gray-400 text-center">
          Click a chart to add it, or drag it where you want it
        </p>
      </div>
    </div>
  );
}
