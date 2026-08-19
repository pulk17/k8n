"use client";

import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Layers, Plus, Search, X } from "lucide-react";
import { fetchCRDs } from "../lib/api";
import { DEFAULT_RESOURCE_COLOR, RESOURCE_COLORS } from "../lib/constants";
import { conceptFor } from "../lib/concepts";
import ConnectionLegend from "./ConnectionLegend";

// Kinds you can add to the canvas, in the order they are worth reaching for.
// Colour is not repeated here: it comes from RESOURCE_COLORS, so the swatch in
// this list is always the colour the node will actually be. This list used to
// carry its own Tailwind classes and had drifted out of step with the nodes.
const CATEGORIES: { name: string; kinds: string[] }[] = [
  { name: "Workloads", kinds: ["Deployment", "StatefulSet", "DaemonSet", "Pod", "Job", "CronJob"] },
  { name: "Networking", kinds: ["Service", "Ingress", "NetworkPolicy"] },
  { name: "Configuration", kinds: ["ConfigMap", "Secret"] },
  { name: "Storage", kinds: ["PersistentVolumeClaim", "PersistentVolume"] },
  {
    name: "Access control",
    kinds: ["ServiceAccount", "Role", "RoleBinding", "ClusterRole", "ClusterRoleBinding"],
  },
  { name: "Scaling", kinds: ["HorizontalPodAutoscaler"] },
];

interface ResourceToolboxProps {
  /** Adds a kind at the centre of the viewport, for people who do not drag. */
  onAdd: (kind: string) => void;
}

/**
 * The palette of things you can put on the canvas.
 *
 * Three things were wrong with the old one. Every row was a bare `div`, so the
 * only way to add a resource was a mouse drag — no keyboard, no screen reader,
 * no way in at all on a touchpad you find awkward. There was no search, so
 * finding ClusterRoleBinding meant scrolling past five categories. And the rows
 * said nothing beyond the kind name, which is no help at all if you do not
 * already know what a DaemonSet is.
 */
export default function ResourceToolbox({ onAdd }: ResourceToolboxProps) {
  const [crds, setCrds] = useState<{ kind: string; name: string; group: string }[]>([]);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // CRDs are a bonus; without a cluster the built-in kinds still work.
    fetchCRDs().then(setCrds).catch(() => {});
  }, []);

  // "/" is the search shortcut every tool with a palette uses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.matches?.("input, textarea, select")) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Matching on the summary as well as the kind means searching for "schedule"
  // finds CronJob, and "password" finds Secret — you can look for the job you
  // are trying to do rather than for a name you may not know yet.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CATEGORIES;

    return CATEGORIES.map(category => ({
      name: category.name,
      kinds: category.kinds.filter(kind => {
        const summary = conceptFor(kind)?.summary ?? "";
        return kind.toLowerCase().includes(q) || summary.toLowerCase().includes(q);
      }),
    })).filter(category => category.kinds.length > 0);
  }, [query]);

  const matchingCrds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return crds;
    return crds.filter(c => c.kind.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
  }, [crds, query]);

  const empty = results.length === 0 && matchingCrds.length === 0;

  return (
    <div className="absolute left-4 top-16 bottom-4 z-20 flex w-64 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/95 shadow-xl backdrop-blur-md">
      <div className="border-b border-neutral-800 p-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-600" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Escape" && setQuery("")}
            placeholder="Search resources…"
            aria-label="Search Kubernetes resource kinds"
            className="w-full rounded border border-neutral-800 bg-neutral-950 py-1.5 pl-7 pr-7 text-xs text-gray-200 transition-colors placeholder:text-gray-600 hover:border-neutral-700 focus:border-blue-500 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-600 hover:text-gray-300"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
        {empty && (
          <p className="px-1 py-6 text-center text-[11px] leading-relaxed text-gray-500">
            Nothing matches “{query}”.
          </p>
        )}

        {results.map(({ name, kinds }) => (
          <div key={name}>
            <h3 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              {name}
            </h3>
            <div className="space-y-1">
              {kinds.map(kind => (
                <KindRow key={kind} kind={kind} onAdd={onAdd} />
              ))}
            </div>
          </div>
        ))}

        {matchingCrds.length > 0 && (
          <div className="border-t border-neutral-800 pt-3">
            <h3 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Custom resources
            </h3>
            <div className="space-y-1">
              {matchingCrds.map(crd => (
                <KindRow
                  key={crd.name}
                  kind={crd.kind}
                  subtitle={crd.group}
                  icon={<Layers className="h-3.5 w-3.5" style={{ color: DEFAULT_RESOURCE_COLOR }} />}
                  onAdd={onAdd}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-neutral-800 px-2.5 py-2">
        <p className="text-[10px] leading-snug text-gray-500">
          Drag onto the canvas, or press <Kbd>Enter</Kbd> to add. <Kbd>/</Kbd> to search.
        </p>
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Connections
          </p>
          <ConnectionLegend />
        </div>
      </div>
    </div>
  );
}

/**
 * One draggable kind.
 *
 * It is a `button`, which is what makes it reachable by keyboard and announced
 * as an action — `draggable` on its own tells assistive technology nothing.
 * Dragging and activating both work, and both end up adding the same node.
 */
function KindRow({
  kind,
  subtitle,
  icon,
  onAdd,
}: {
  kind: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onAdd: (kind: string) => void;
}) {
  const color = RESOURCE_COLORS[kind] || DEFAULT_RESOURCE_COLOR;
  const summary = subtitle ?? conceptFor(kind)?.summary;

  const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData("application/reactflow", "k8sNode");
    event.dataTransfer.setData("application/k8sKind", kind);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={() => onAdd(kind)}
      title={summary ? `${kind} — ${summary}` : kind}
      className="group flex w-full cursor-grab items-start gap-2.5 rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-left transition-colors hover:border-neutral-600 hover:bg-neutral-800 active:cursor-grabbing"
    >
      <span className="mt-0.5 flex-shrink-0" aria-hidden>
        {icon ?? <span className="block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-gray-300">{kind}</span>
        {summary && (
          <span className="mt-0.5 block truncate text-[10px] leading-snug text-gray-500">
            {summary}
          </span>
        )}
      </span>

      <Plus className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-700 transition-colors group-hover:text-gray-400" />
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-neutral-700 bg-neutral-800 px-1 font-mono text-[9px] text-gray-400">
      {children}
    </kbd>
  );
}
