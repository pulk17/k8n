"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { Forward, errorMessage, fetchForwards, stopForward } from "../lib/api";
import { notifyError } from "../lib/dialog";
import { TUNNELS_CHANGED } from "./ResourceActions";

/** The tunnels k8n has open, so none is forgotten running in the background. */
export default function Tunnels() {
  const [forwards, setForwards] = useState<Forward[]>([]);

  const refresh = useCallback(() => {
    fetchForwards().then(setForwards).catch(() => setForwards([]));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(TUNNELS_CHANGED, refresh);
    // A tunnel closes on its own when its pod goes away.
    const t = setInterval(refresh, 10000);
    return () => {
      window.removeEventListener(TUNNELS_CHANGED, refresh);
      clearInterval(t);
    };
  }, [refresh]);

  if (forwards.length === 0) return null;

  return (
    <div
      aria-label="Open tunnels"
      className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-blue-950/20"
    >
      <p className="mb-2 text-xs font-semibold text-blue-800 dark:text-blue-300">Open in your browser</p>
      <ul className="space-y-1">
        {forwards.map(f => (
          <li key={f.id} className="flex flex-wrap items-center gap-3 text-xs">
            <a
              href={f.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-blue-700 hover:underline dark:text-blue-400"
            >
              {f.url}
              <ExternalLink className="h-3 w-3" />
            </a>
            <span className="text-gray-600 dark:text-gray-400">
              → {f.kind} {f.namespace}/{f.name} port {f.remotePort}
            </span>
            <button
              onClick={() =>
                stopForward(f.id)
                  .catch(err => notifyError(errorMessage(err)))
                  .finally(refresh)
              }
              className="ml-auto inline-flex items-center gap-1 text-gray-500 hover:text-red-600"
              aria-label={`Stop tunnel to ${f.name}`}
            >
              <X className="h-3.5 w-3.5" /> Stop
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
