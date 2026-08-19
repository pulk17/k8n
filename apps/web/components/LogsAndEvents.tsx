"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, FileText, Loader2, RefreshCw } from "lucide-react";
import { ClusterEvent, errorMessage, fetchEvents, fetchPodLogs } from "../lib/api";

// The logs/events reader, with no window chrome around it.
//
// Two surfaces need exactly this: the floating InspectPanel on the deployed
// page, and the Live tab of the canvas inspector. It was written once inside
// InspectPanel; pulling it out is what stops the second copy from existing.

type Tab = "logs" | "events";

/** Only pods have logs; everything else opens straight on its events. */
export const hasLogs = (kind: string) => kind === "Pod";

const TAIL_OPTIONS = [100, 200, 500, 1000];

export default function LogsAndEvents({
  kind,
  name,
  namespace,
}: {
  kind: string;
  name: string;
  namespace: string;
}) {
  const [tab, setTab] = useState<Tab>(hasLogs(kind) ? "logs" : "events");
  const [logs, setLogs] = useState("");
  const [events, setEvents] = useState<ClusterEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tail, setTail] = useState(200);
  const [previous, setPrevious] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "logs") {
        const result = await fetchPodLogs(namespace, name, { tailLines: tail, previous });
        setLogs(result?.logs ?? "");
      } else {
        setEvents(await fetchEvents(namespace, name));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tab, tail, previous, namespace, name]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-neutral-800 px-3 py-2">
        {hasLogs(kind) && (
          <TabButton active={tab === "logs"} onClick={() => setTab("logs")}>
            Logs
          </TabButton>
        )}
        <TabButton active={tab === "events"} onClick={() => setTab("events")}>
          Events
        </TabButton>

        <button
          onClick={load}
          disabled={loading}
          className="ml-auto rounded p-1.5 text-gray-400 transition-colors hover:bg-neutral-800 hover:text-gray-200 disabled:opacity-50"
          title="Reload"
          aria-label="Reload"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {tab === "logs" && (
        <div className="flex items-center gap-3 border-b border-neutral-800 px-3 py-1.5">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-400">
            <input
              type="checkbox"
              checked={previous}
              onChange={e => setPrevious(e.target.checked)}
              className="h-3 w-3 accent-blue-600"
            />
            Previous container
          </label>
          <select
            value={tail}
            onChange={e => setTail(Number(e.target.value))}
            aria-label="Number of log lines"
            className="ml-auto rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-[11px] text-gray-200"
          >
            {TAIL_OPTIONS.map(n => (
              <option key={n} value={n}>
                {n} lines
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        )}

        {error && !loading && (
          <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        {!error && !loading && tab === "logs" && (
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-gray-300">
            {logs || "This container has not written anything yet."}
          </pre>
        )}

        {!error && !loading && tab === "events" && (
          <div className="space-y-2">
            {events.length === 0 && (
              <p className="py-8 text-center text-xs leading-relaxed text-gray-500">
                No events. Kubernetes keeps them for about an hour, so a quiet
                resource that started long ago has none.
              </p>
            )}
            {events.map((event, i) => (
              <div
                key={`${event.reason}-${event.lastSeen}-${i}`}
                className="rounded border border-neutral-800 bg-neutral-800/40 p-2"
              >
                <div className="flex items-center gap-2">
                  {event.type === "Warning" ? (
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-yellow-500" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
                  )}
                  <span className="text-xs font-medium text-gray-200">{event.reason}</span>
                  {event.count > 1 && (
                    <span className="rounded bg-neutral-700 px-1.5 text-[10px] text-gray-400">
                      ×{event.count}
                    </span>
                  )}
                  <span className="ml-auto truncate font-mono text-[10px] text-gray-500">
                    {event.object}
                  </span>
                </div>
                <p className="mt-1 break-words text-[11px] leading-relaxed text-gray-400">
                  {event.message}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
        active ? "bg-neutral-700 text-gray-100" : "text-gray-400 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
