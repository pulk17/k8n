"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { ChangeEntry, errorMessage, fetchHistory } from "../lib/api";

/**
 * What k8n has changed, newest first.
 *
 * The cluster records that a Deployment has 3 replicas, not that you scaled it
 * from here twenty minutes ago. k8n writes a line per change to
 * ~/.k8n/history.jsonl; this reads it back, on demand — it is the answer to
 * "did I do that, or did something else?".
 */
export default function RecentChanges() {
  const [changes, setChanges] = useState<ChangeEntry[] | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    fetchHistory(50)
      .then(setChanges)
      .catch(err => setError(errorMessage(err)));
  };

  return (
    <details
      className="mb-4 rounded border border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      onToggle={e => e.currentTarget.open && load()}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
        <History className="h-4 w-4 text-gray-500" />
        What k8n changed
      </summary>

      <div className="border-t border-gray-200 px-3 py-2 dark:border-neutral-800">
        {error && <p className="text-xs text-red-500">{error}</p>}
        {!error && !changes && <p className="text-xs text-gray-500">Reading…</p>}
        {changes?.length === 0 && (
          <p className="text-xs text-gray-500">Nothing yet — applying, scaling or upgrading writes a line here.</p>
        )}
        <ul className="divide-y divide-gray-100 dark:divide-neutral-800">
          {changes?.map((change, i) => (
            <li key={i} className="flex items-baseline gap-2 py-1.5 text-xs">
              <time className="w-32 flex-shrink-0 text-gray-500" dateTime={change.at}>
                {new Date(change.at).toLocaleString()}
              </time>
              <span className="w-24 flex-shrink-0 font-medium text-gray-700 dark:text-gray-300">{change.action}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-gray-600 dark:text-gray-400">
                {(change.targets ?? []).join(", ")}
                {change.detail && ` — ${change.detail}`}
              </span>
              {change.cluster && <span className="flex-shrink-0 text-gray-500">{change.cluster}</span>}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
