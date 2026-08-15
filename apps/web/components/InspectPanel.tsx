"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, FileText, RefreshCw, X } from "lucide-react";
import { ClusterEvent, errorMessage, fetchEvents, fetchPodLogs, K8sResource } from "../lib/api";

type Tab = "logs" | "events";

interface InspectPanelProps {
  resource: K8sResource;
  onClose: () => void;
}

/** Only pods have logs; everything else opens straight on its events. */
const hasLogs = (kind: string) => kind === "Pod";

const TAIL_OPTIONS = [100, 200, 500, 1000];

/**
 * Logs and events for one resource.
 *
 * Both endpoints existed on the API from the start with nothing calling them,
 * so the answer to "why is this pod unhappy" meant leaving for kubectl.
 */
export default function InspectPanel({ resource, onClose }: InspectPanelProps) {
  const [tab, setTab] = useState<Tab>(hasLogs(resource.kind) ? "logs" : "events");
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
        const result = await fetchPodLogs(resource.namespace, resource.name, {
          tailLines: tail,
          previous,
        });
        setLogs(result?.logs ?? "");
      } else {
        setEvents(await fetchEvents(resource.namespace, resource.name));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tab, tail, previous, resource.namespace, resource.name]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="fixed bottom-4 right-4 top-20 z-50 flex w-[560px] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-800/50 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-gray-100">{resource.name}</h3>
          <p className="truncate text-xs text-gray-400">
            {resource.kind} · {resource.namespace}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="rounded p-1.5 text-gray-400 transition-colors hover:bg-neutral-700 hover:text-gray-200 disabled:opacity-50"
            title="Reload"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-gray-400 transition-colors hover:bg-neutral-700 hover:text-gray-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-neutral-800 px-3 py-2">
        {hasLogs(resource.kind) && (
          <TabButton active={tab === "logs"} onClick={() => setTab("logs")}>
            Logs
          </TabButton>
        )}
        <TabButton active={tab === "events"} onClick={() => setTab("events")}>
          Events
        </TabButton>

        {tab === "logs" && (
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={previous}
                onChange={e => setPrevious(e.target.checked)}
                className="h-3 w-3 accent-blue-600"
              />
              Previous
            </label>
            <select
              value={tail}
              onChange={e => setTail(Number(e.target.value))}
              className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-gray-200"
            >
              {TAIL_OPTIONS.map(n => (
                <option key={n} value={n}>
                  {n} lines
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-3">
        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        {!error && tab === "logs" && (
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-gray-300">
            {logs || (loading ? "" : "This container has not written anything yet.")}
          </pre>
        )}

        {!error && tab === "events" && (
          <div className="space-y-2">
            {events.length === 0 && !loading && (
              <p className="py-8 text-center text-xs text-gray-500">
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
                  <span className="ml-auto font-mono text-[10px] text-gray-500">{event.object}</span>
                </div>
                <p className="mt-1 break-words text-[11px] text-gray-400">{event.message}</p>
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
      className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
        active ? "bg-neutral-700 text-gray-100" : "text-gray-400 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
