"use client";

import { useEffect, useState } from "react";
import { Cpu, HardDrive } from "lucide-react";
import { errorMessage, fetchPodMetrics, fetchResourceMetrics } from "../lib/api";
import LogsAndEvents from "./LogsAndEvents";

// What the cluster is actually doing with this object right now: current usage
// on top, logs and events underneath.
//
// This replaces the free-floating PodMetricsPanel, which opened at top-right on
// top of whatever else was already open there, and only ever worked for pods.

const REFRESH_MS = 5000;

interface Usage {
  cpu: string;
  memory: string;
  detail?: string;
}

/**
 * Current usage for one resource.
 *
 * Pods report their own figures; anything else reports the average across the
 * pods it owns, so the number means "per pod" rather than "for the whole
 * Deployment" — worth saying on screen, because the two differ by the replica
 * count and it is an easy thing to misread.
 */
async function fetchUsage(kind: string, name: string, namespace: string): Promise<Usage> {
  if (kind === "Pod") {
    const m = await fetchPodMetrics(name, namespace);
    return {
      cpu: m.cpu,
      memory: m.memory,
      detail: m.containers.length > 1 ? `${m.containers.length} containers` : m.containers[0]?.name,
    };
  }

  const m = await fetchResourceMetrics(namespace, kind, name);
  return {
    cpu: `${m.cpu}m`,
    memory: `${m.memory}Mi`,
    detail: `average across ${m.pods} ${m.pods === 1 ? "pod" : "pods"}`,
  };
}

export default function InspectorLive({
  kind,
  name,
  namespace,
}: {
  kind: string;
  name: string;
  namespace: string;
}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Polling lives entirely inside the effect, with a cancelled flag, so a
  // reply for the resource you just navigated away from cannot land on the one
  // you are looking at now — and so nothing sets state before the first await.
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const next = await fetchUsage(kind, name, namespace);
        if (cancelled) return;
        setUsage(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setUsage(null);
        setError(errorMessage(err));
      }
    };

    poll();
    const timer = setInterval(poll, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [kind, name, namespace]);

  // metrics-server is optional, and its absence is by far the most common
  // reason this is empty — worth naming, rather than showing a bare 404.
  const missingMetricsServer =
    error?.includes("404") || error?.toLowerCase().includes("not found");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-neutral-800 p-3">
        {usage ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat icon={Cpu} label="CPU" value={usage.cpu} />
              <Stat icon={HardDrive} label="Memory" value={usage.memory} />
            </div>
            {usage.detail && <p className="mt-2 text-[10px] text-gray-500">{usage.detail}</p>}
          </>
        ) : (
          <p className="text-[11px] leading-relaxed text-gray-500">
            No usage figures.{" "}
            {missingMetricsServer
              ? "metrics-server is probably not installed in this cluster — HPAs and kubectl top need it too."
              : error ?? "Waiting for the first sample."}
          </p>
        )}
      </div>

      <LogsAndEvents kind={kind} name={name} namespace={namespace} />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-800/40 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className="mt-0.5 font-mono text-sm text-gray-100">{value}</p>
    </div>
  );
}
