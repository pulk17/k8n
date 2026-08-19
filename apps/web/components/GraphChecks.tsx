"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronUp, Info } from "lucide-react";
import { GraphIssue } from "../lib/graphChecks";

/**
 * The status strip along the bottom of the canvas.
 *
 * It already counted nodes and connections. What it now also carries is the
 * result of the graph checks — because the moment to tell someone their Service
 * selects nothing is while they are drawing it, not after an apply that
 * succeeds and then quietly does not work.
 *
 * Clicking an issue selects the node it belongs to, so the explanation and the
 * field you need to change end up on screen together.
 */

interface GraphChecksProps {
  nodeCount: number;
  edgeCount: number;
  scopeLabel: string;
  issues: GraphIssue[];
  onSelectNode: (nodeId: string) => void;
}

export default function GraphChecks({
  nodeCount,
  edgeCount,
  scopeLabel,
  issues,
  onSelectNode,
}: GraphChecksProps) {
  const [open, setOpen] = useState(false);

  const warnings = issues.filter(i => i.level === "warning").length;
  const infos = issues.length - warnings;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* A graph that fixes itself collapses the list on its own, because the
          toggle disappears with the last issue. */}
      {open && issues.length > 0 && (
        <div className="animate-panel-in max-h-[45vh] w-[520px] max-w-[80vw] overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl">
          <div className="sticky top-0 border-b border-neutral-800 bg-neutral-900 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Checks on this graph
            </p>
          </div>
          <ul className="divide-y divide-neutral-800">
            {issues.map((issue, i) => (
              <li key={`${issue.nodeId}-${i}`}>
                <button
                  onClick={() => onSelectNode(issue.nodeId)}
                  className="w-full px-3 py-2.5 text-left transition-colors hover:bg-neutral-800/60"
                >
                  <div className="flex items-start gap-2">
                    {issue.level === "warning" ? (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-yellow-500" />
                    ) : (
                      <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-blue-400" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-200">{issue.title}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{issue.why}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
                        <span className="text-gray-500">Fix: </span>
                        {issue.fix}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-3 whitespace-nowrap rounded border border-neutral-800 bg-neutral-900/90 px-3 py-1.5 text-xs text-gray-400 backdrop-blur-sm">
        <span>{nodeCount} {nodeCount === 1 ? "node" : "nodes"}</span>
        <Separator />
        <span>{edgeCount} {edgeCount === 1 ? "connection" : "connections"}</span>
        <Separator />
        <span className="text-blue-400">{scopeLabel}</span>
        <Separator />

        {issues.length === 0 ? (
          <span className="flex items-center gap-1.5 text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            No issues
          </span>
        ) : (
          <button
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            className="flex items-center gap-1.5 rounded px-1 text-gray-300 transition-colors hover:text-gray-100"
          >
            {warnings > 0 && (
              <span className="flex items-center gap-1 text-yellow-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {warnings}
              </span>
            )}
            {infos > 0 && (
              <span className="flex items-center gap-1 text-blue-400">
                <Info className="h-3.5 w-3.5" />
                {infos}
              </span>
            )}
            <ChevronUp
              className={`h-3 w-3 transition-transform ${open ? "" : "rotate-180"}`}
            />
          </button>
        )}
      </div>
    </div>
  );
}

const Separator = () => <span className="text-neutral-700" aria-hidden>|</span>;
