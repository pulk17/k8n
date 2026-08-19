"use client";

import { X } from "lucide-react";
import { K8sResource } from "../lib/api";
import LogsAndEvents from "./LogsAndEvents";

/**
 * Logs and events for one resource on the deployed page, in a floating window.
 *
 * The reading half of this used to live here in full. The canvas inspector
 * needs exactly the same thing in a different frame, so the fetching, tabs and
 * rendering moved to LogsAndEvents and this file is now only the window around
 * it — a title, and a way to close it.
 */
export default function InspectPanel({
  resource,
  onClose,
}: {
  resource: K8sResource;
  onClose: () => void;
}) {
  return (
    <div className="fixed bottom-4 right-4 top-20 z-50 flex w-[560px] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-800/50 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-gray-100">{resource.name}</h3>
          <p className="truncate text-xs text-gray-400">
            {resource.kind} · {resource.namespace}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1.5 text-gray-400 transition-colors hover:bg-neutral-700 hover:text-gray-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <LogsAndEvents
        kind={resource.kind}
        name={resource.name}
        namespace={resource.namespace}
      />
    </div>
  );
}
