"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Box,
  Briefcase,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  ExternalLink,
  FileCode,
  Globe,
  Layers,
  Lock,
  MoreHorizontal,
  Network,
  RefreshCw,
  ScrollText,
  Stethoscope,
  Trash2,
} from "lucide-react";
import {
  DiagnosisReport,
  deleteResource,
  errorMessage,
  fetchDiagnosis,
  K8sResource,
  watchResources,
} from "../../lib/api";
import { DEFAULT_RESOURCE_COLOR, RESOURCE_COLORS, statusStyle } from "../../lib/constants";
import { confirmAction, notify, notifyError } from "../../lib/dialog";
import ApiConnectionError from "../../components/ApiConnectionError";
import InspectPanel from "../../components/InspectPanel";
import ResourceMonitoringDashboard from "../../components/ResourceMonitoringDashboard";

const KIND_ICONS: Record<string, typeof Box> = {
  Deployment: Box,
  Service: Globe,
  Pod: Box,
  ConfigMap: FileCode,
  Secret: Lock,
  ReplicaSet: Layers,
  StatefulSet: Database,
  DaemonSet: Briefcase,
  Job: Clock,
  CronJob: Clock,
  Ingress: Network,
};

/** Kinds that have pod-level metrics worth charting. */
const MONITORABLE = ["Pod", "Deployment", "StatefulSet", "DaemonSet"];

/** The detail lines shown when a resource row is expanded. */
function detailsOf(r: K8sResource): [string, string][] {
  const rows: [string, string][] = [];
  const add = (label: string, value: string | number | undefined | null) => {
    if (value !== undefined && value !== null && value !== "") rows.push([label, String(value)]);
  };

  if (r.replicas !== undefined) add("Replicas", `${r.readyReplicas || 0}/${r.replicas}`);
  add("Image", r.image);
  add("Pod IP", r.podIP);
  add("Node", r.nodeName);
  if (r.restartCount) add("Restarts", r.restartCount);
  add("Owner", r.ownerReferences?.[0]);
  add("Type", r.serviceType);
  add("Cluster IP", r.clusterIP);
  add("External IP", r.externalIP);
  add("Ports", r.ports?.join(", "));
  add("Keys", r.dataKeys?.join(", "));
  add("Storage", r.storageSize);
  add("Scale target", r.scaleTargetName && `${r.scaleTargetKind}/${r.scaleTargetName}`);
  add("Hosts", r.hosts?.join(", "));
  return rows;
}

/** Status messages are only worth surfacing while something is still settling. */
function messageTone(r: K8sResource): "error" | "warning" | "info" | null {
  if (!r.statusMessage) return null;
  if (["Error", "Failed", "NotReady"].includes(r.status)) return "error";
  if (r.status === "Completed") return "info";
  if (r.status === "Pending") {
    const transient = ["ContainerCreating", "PodInitializing"].some((s) => r.statusMessage!.includes(s));
    return transient ? null : "warning";
  }
  return null;
}

const MESSAGE_STYLES = {
  error: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400",
  warning: "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-900/30 text-yellow-600 dark:text-yellow-400",
  info: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/30 text-blue-600 dark:text-blue-400",
};

export default function DeployedPage() {
  const [resources, setResources] = useState<K8sResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [namespace, setNamespace] = useState("all");
  const [hideProtected, setHideProtected] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [monitoring, setMonitoring] = useState<K8sResource | null>(null);
  const [inspecting, setInspecting] = useState<K8sResource | null>(null);
  const [diagnosis, setDiagnosis] = useState<DiagnosisReport | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  // Bumping this drops the stream and opens a new one.
  const [attempt, setAttempt] = useState(0);
  const reconnect = useCallback(() => setAttempt((n) => n + 1), []);

  // Everything comes off the watch stream, so a rollout shows up on its own.
  // It carries all namespaces because the namespace dropdown below is built
  // from whatever came back.
  useEffect(() => {
    setLoading(true);
    setError(null);
    return watchResources(
      undefined,
      (next) => {
        setResources(next);
        setLoading(false);
        setError(null);
      },
      (message) => {
        setError(message);
        setLoading(false);
      }
    );
  }, [attempt]);

  const namespaces = Array.from(new Set(resources.map((r) => r.namespace).filter(Boolean))).sort();
  const visible = resources
    .filter((r) => namespace === "all" || r.namespace === namespace)
    .filter((r) => !hideProtected || !r.protected);
  const deletable = visible.filter((r) => !r.protected);

  const byKind = visible.reduce<Record<string, K8sResource[]>>((acc, r) => {
    (acc[r.kind] ||= []).push(r);
    return acc;
  }, {});

  // Deterministic health checks. Runs over whichever namespaces are on screen,
  // so it still works with the dropdown left on "All Namespaces".
  const runDiagnosis = async () => {
    const targets = namespace === "all" ? namespaces : [namespace];
    if (targets.length === 0) return;

    setDiagnosing(true);
    try {
      const reports = await Promise.all(targets.map(ns => fetchDiagnosis(ns)));
      setDiagnosis({
        namespace: namespace === "all" ? "all namespaces" : namespace,
        findings: reports.flatMap(r => r?.findings ?? []),
        checked: reports.reduce((n, r) => n + (r?.checked ?? 0), 0),
      });
    } catch (err) {
      notifyError(errorMessage(err));
    } finally {
      setDiagnosing(false);
    }
  };

  const remove = async (r: K8sResource) => {
    const ok = await confirmAction({
      title: "Delete resource",
      message: `${r.kind} "${r.name}" in namespace "${r.namespace}".\n\nThis cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;

    setBusy(r.uid);
    try {
      await deleteResource(r.kind, r.name, r.namespace);
      notify(`Deleted ${r.kind}/${r.name}`, "success");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Failed to delete resource");
    } finally {
      setBusy(null);
    }
  };

  const removeAll = async () => {
    const targets = deletable;
    if (targets.length === 0) {
      notify("Nothing to delete in this view");
      return;
    }
    const ok = await confirmAction({
      title: "Delete everything shown",
      message: `${targets.length} resource(s) will be deleted. This cannot be undone.`,
      confirmLabel: `Delete ${targets.length}`,
      danger: true,
    });
    if (!ok) return;

    setBusy("all");
    const results = await Promise.allSettled(
      targets.map((r) => deleteResource(r.kind, r.name, r.namespace))
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    setBusy(null);

    if (failed) notifyError(`Deleted ${targets.length - failed}, failed ${failed}.`);
    else notify(`Deleted ${targets.length} resources.`, "success");
  };

  if (error?.includes("Cannot connect")) {
    return <ApiConnectionError error={error} onRetry={reconnect} />;
  }

  return (
    <div className="h-screen overflow-y-auto bg-gray-50 dark:bg-neutral-950">
      <div className="mx-auto max-w-7xl p-8 pb-24">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <Link
              href="/canvas"
              className="mb-2 inline-flex items-center gap-2 text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Canvas
            </Link>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Deployed Resources</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Everything currently running in your cluster.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {error ? (
              <button
                onClick={reconnect}
                className="flex items-center gap-2 rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:border-neutral-700 dark:text-gray-300 dark:hover:bg-neutral-800"
              >
                <RefreshCw className="h-4 w-4" />
                Reconnect
              </button>
            ) : (
              <span
                className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"
                title="Updates arrive as the cluster changes"
              >
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Live
              </span>
            )}
            <button
              onClick={runDiagnosis}
              disabled={diagnosing || resources.length === 0}
              className="flex items-center gap-2 rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-neutral-700 dark:text-gray-300 dark:hover:bg-neutral-800"
              title="Check for failing pods, stuck rollouts and unbound volumes"
            >
              <Stethoscope className={`h-4 w-4 ${diagnosing ? "animate-pulse" : ""}`} />
              Diagnose
            </button>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-4">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Namespace:</label>
          <select
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-gray-100"
          >
            <option value="all">All Namespaces</option>
            {namespaces.map((ns) => (
              <option key={ns} value={ns}>
                {ns}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={hideProtected}
              onChange={(e) => setHideProtected(e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
            Hide system resources
          </label>

          <span className="text-sm text-gray-500 dark:text-gray-400">{visible.length} resources</span>

          <details className="relative ml-auto">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:border-neutral-700 dark:text-gray-300 dark:hover:bg-neutral-800">
              <MoreHorizontal className="h-4 w-4" />
              Bulk actions
            </summary>
            <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded border border-gray-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
              <button
                onClick={removeAll}
                disabled={busy === "all" || deletable.length === 0}
                className="flex w-full items-start gap-2 rounded px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/20"
                title="Delete every non-system resource shown"
              >
                <Trash2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>
                  <span className="block font-medium">Delete all shown</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {deletable.length} non-system {deletable.length === 1 ? "resource" : "resources"}
                  </span>
                </span>
              </button>
            </div>
          </details>
        </div>

        {loading && (
          <div className="py-12 text-center">
            <RefreshCw className="mx-auto mb-2 h-8 w-8 animate-spin text-blue-500" />
            <p className="text-gray-600 dark:text-gray-400">Loading resources...</p>
          </div>
        )}

        {error && !loading && (
          <div className="mb-6 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/20 dark:text-red-400">
            {error}
          </div>
        )}

        {diagnosis && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Diagnosis — {diagnosis.namespace}
              </h2>
              <button
                onClick={() => setDiagnosis(null)}
                className="text-xs text-gray-500 hover:underline"
              >
                Dismiss
              </button>
            </div>

            {diagnosis.findings.length === 0 ? (
              <p className="text-sm text-green-600 dark:text-green-400">
                Nothing wrong across {diagnosis.checked} workload(s).
              </p>
            ) : (
              <div className="space-y-2">
                {diagnosis.findings.map((f, i) => (
                  <div
                    key={`${f.kind}-${f.name}-${f.reason}-${i}`}
                    className={`rounded border p-3 text-xs ${
                      MESSAGE_STYLES[f.severity === "critical" ? "error" : f.severity === "warning" ? "warning" : "info"]
                    }`}
                  >
                    <div className="font-semibold">
                      {f.reason} — {f.kind}/{f.name}
                    </div>
                    <p className="mt-1 break-words opacity-90">{f.detail}</p>
                    {f.hint && <p className="mt-1 italic opacity-75">{f.hint}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-white py-12 text-center dark:border-neutral-800 dark:bg-neutral-900">
            <Box className="mx-auto mb-3 h-12 w-12 text-gray-400" />
            <p className="mb-2 text-gray-600 dark:text-gray-400">No resources found</p>
            <p className="text-sm text-gray-500">Deploy something from the canvas to see it here.</p>
          </div>
        )}

        <div className="space-y-6">
          {Object.entries(byKind).map(([kind, items]) => {
            const Icon = KIND_ICONS[kind] || Box;
            const color = RESOURCE_COLORS[kind] || DEFAULT_RESOURCE_COLOR;

            return (
              <div
                key={kind}
                className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div
                  className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-neutral-800"
                  style={{ backgroundColor: `${color}10` }}
                >
                  <Icon className="h-5 w-5" style={{ color }} />
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{kind}</h2>
                  <span className="text-sm text-gray-500 dark:text-gray-400">({items.length})</span>
                </div>

                <div className="divide-y divide-gray-200 dark:divide-neutral-800">
                  {items.map((r) => {
                    const status = statusStyle(r.status);
                    const isOpen = expanded[r.uid];
                    const tone = messageTone(r);

                    return (
                      <div key={r.uid} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-neutral-800/50">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <button
                              onClick={() => setExpanded((p) => ({ ...p, [r.uid]: !p[r.uid] }))}
                              className="flex w-full flex-wrap items-center gap-2 text-left"
                            >
                              {isOpen ? (
                                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                              )}
                              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                {r.name}
                              </span>
                              <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-500 dark:bg-neutral-800 dark:text-gray-400">
                                {r.namespace}
                              </span>
                              {r.createdAt && (
                                <span className="text-xs text-gray-400">{r.createdAt}</span>
                              )}
                            </button>

                            {isOpen && (
                              <dl className="mt-2 space-y-1 border-l-2 border-gray-200 pl-4 text-xs dark:border-neutral-700">
                                {detailsOf(r).map(([label, value]) => (
                                  <div key={label} className="flex gap-2">
                                    <dt className="min-w-[84px] text-gray-500">{label}</dt>
                                    <dd className="break-all font-mono text-gray-700 dark:text-gray-300">
                                      {value}
                                    </dd>
                                  </div>
                                ))}
                                {Object.entries(r.labels || {}).length > 0 && (
                                  <div className="flex gap-2">
                                    <dt className="min-w-[84px] text-gray-500">Labels</dt>
                                    <dd className="flex flex-wrap gap-1">
                                      {Object.entries(r.labels).map(([k, v]) => (
                                        <span
                                          key={k}
                                          className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-600 dark:bg-neutral-800 dark:text-gray-400"
                                        >
                                          {k}={v}
                                        </span>
                                      ))}
                                    </dd>
                                  </div>
                                )}
                              </dl>
                            )}

                            {tone && (
                              <div className={`mt-2 rounded border p-2 text-xs ${MESSAGE_STYLES[tone]}`}>
                                {r.statusMessage}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-shrink-0 items-center gap-2">
                            <button
                              onClick={() => setInspecting(r)}
                              className="rounded p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-neutral-800"
                              title={r.kind === "Pod" ? "Logs and events" : "Events"}
                            >
                              <ScrollText className="h-4 w-4" />
                            </button>

                            {MONITORABLE.includes(r.kind) && (
                              <button
                                onClick={() => setMonitoring(r)}
                                className="rounded p-2 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/20"
                                title="Monitor resource"
                              >
                                <Activity className="h-4 w-4" />
                              </button>
                            )}

                            <div className={`flex items-center gap-2 rounded px-3 py-1 ${status.bg}`}>
                              <span className={`h-2 w-2 rounded-full ${status.dot}`} />
                              <span className={`text-xs font-medium ${status.text}`}>{r.status}</span>
                            </div>

                            {r.protected ? (
                              <span
                                className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-500 dark:bg-neutral-800 dark:text-gray-400"
                                title="Cluster machinery — delete it with kubectl if you must"
                              >
                                System
                              </span>
                            ) : (
                              <button
                                onClick={() => remove(r)}
                                disabled={busy === r.uid}
                                className="rounded p-2 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/20"
                                title="Delete resource"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {monitoring && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setMonitoring(null)}
          >
            <div className="w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">Monitoring: {monitoring.name}</h2>
                <button
                  onClick={() => setMonitoring(null)}
                  className="rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-600"
                >
                  Close
                </button>
              </div>
              <ResourceMonitoringDashboard
                resourceName={monitoring.name}
                resourceKind={monitoring.kind}
                namespace={monitoring.namespace}
              />
            </div>
          </div>
        )}

        {inspecting && (
          <InspectPanel resource={inspecting} onClose={() => setInspecting(null)} />
        )}

        <div className="mt-8 rounded-lg border border-neutral-800 bg-neutral-900 p-6">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-100">
            <ExternalLink className="h-5 w-5" />
            Equivalent kubectl commands
          </h3>
          <div className="space-y-2 text-sm">
            {["get all", "get pods --watch"].map((cmd) => (
              <code key={cmd} className="block rounded bg-black/50 px-3 py-2 font-mono text-green-400">
                kubectl {cmd} -n {namespace === "all" ? "default" : namespace}
              </code>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
