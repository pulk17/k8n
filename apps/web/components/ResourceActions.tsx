"use client";

import { useEffect, useState } from "react";
import { Copy, ExternalLink, Eye, Loader2, Play, RotateCcw, RefreshCw, Scale, Shield, Terminal, X } from "lucide-react";
import {
  Forward,
  K8sResource,
  Permission,
  errorMessage,
  execInPod,
  fetchForwards,
  fetchPermissions,
  revealSecret,
  startForward,
  stopForward,
  workloadAction,
} from "../lib/api";
import { confirmAction, notify, notifyError } from "../lib/dialog";
import { age, localTime } from "../lib/constants";

/** Tells every tunnel view to refresh after one is opened or closed. */
export const TUNNELS_CHANGED = "k8n:tunnels";
export const tunnelsChanged = () => window.dispatchEvent(new Event(TUNNELS_CHANGED));

/** The engine's open tunnels: the one list both the tunnels bar and each resource read. */
export function useForwards() {
  const [forwards, setForwards] = useState<Forward[]>([]);
  useEffect(() => {
    const refresh = () => fetchForwards().then(setForwards).catch(() => setForwards([]));
    refresh();
    window.addEventListener(TUNNELS_CHANGED, refresh);
    // A tunnel closes on its own when its pod goes away.
    const t = setInterval(refresh, 10000);
    return () => {
      window.removeEventListener(TUNNELS_CHANGED, refresh);
      clearInterval(t);
    };
  }, []);
  return forwards;
}

const button =
  "inline-flex items-center gap-1.5 rounded border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-neutral-700 dark:text-gray-300 dark:hover:bg-neutral-800";
const input =
  "rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-gray-100";

/**
 * What you can do to one live resource, beyond deleting it: the things people
 * otherwise open a terminal for. Shown under a row when it is expanded.
 */
export default function ResourceActions({ r, jobs = [] }: { r: K8sResource; jobs?: K8sResource[] }) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (err) {
      notifyError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const spin = (what: string, Icon: typeof Play) =>
    busy === what ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />;

  const blocks: React.ReactNode[] = [];

  if (FORWARDABLE.includes(r.kind)) {
    const ports = (r.ports ?? []).map(p => parseInt(p, 10)).filter(n => !Number.isNaN(n));
    blocks.push(<OpenInBrowser key="forward" kind={r.kind} namespace={r.namespace} name={r.name} ports={ports} />);
  }
  if (r.kind === "Secret") blocks.push(<SecretValues key="secret" r={r} />);
  if (r.kind === "Deployment" || r.kind === "StatefulSet") {
    blocks.push(<ScaleControl key="scale" r={r} busy={busy} run={run} spin={spin} />);
  }
  if (["Deployment", "StatefulSet", "DaemonSet"].includes(r.kind)) {
    blocks.push(
      <div key="rollout" className="flex flex-wrap items-center gap-2">
        <button
          className={button}
          disabled={busy !== null}
          title="Replace every pod, a few at a time — picks up changed ConfigMaps and Secrets"
          onClick={() =>
            run("restart", async () => {
              const res = await workloadAction("restart", r.kind, r.namespace, r.name);
              notify(res.message, "success");
            })
          }
        >
          {spin("restart", RefreshCw)} Restart
        </button>
        {r.kind === "Deployment" && (
          <button
            className={button}
            disabled={busy !== null}
            title="Go back to the previous version of the pod template"
            onClick={async () => {
              const ok = await confirmAction({
                title: "Roll back?",
                message: `${r.name} goes back to its previous revision — the image and settings it ran before the last change.`,
                confirmLabel: "Roll back",
              });
              if (ok)
                run("rollback", async () => {
                  const res = await workloadAction("rollback", r.kind, r.namespace, r.name);
                  notify(res.message, "success");
                });
            }}
          >
            {spin("rollback", RotateCcw)} Roll back
          </button>
        )}
      </div>
    );
  }
  if (r.kind === "Pod") blocks.push(<RunCommand key="exec" r={r} />);
  if (r.kind === "ServiceAccount") blocks.push(<Permissions key="rbac" r={r} />);
  if (r.kind === "CronJob") blocks.push(<JobHistory key="jobs" jobs={jobs} />);

  if (blocks.length === 0) return null;
  return <div className="mt-3 space-y-3 border-l-2 border-blue-200 pl-4 dark:border-blue-900/50">{blocks}</div>;
}

type Runner = {
  busy: string | null;
  run: (what: string, fn: () => Promise<void>) => Promise<void>;
  spin: (what: string, Icon: typeof Play) => React.ReactNode;
};

/** Kinds a tunnel can reach: a Service, a workload (one of its ready pods), a Pod. */
export const FORWARDABLE = ["Service", "Deployment", "StatefulSet", "DaemonSet", "Pod"];

/**
 * Port-forward, named for what people want from it. A pod's port is on the
 * cluster's own network, and on a laptop cluster a NodePort is not reachable
 * either, so this is how anything in the cluster gets opened locally.
 */
export function OpenInBrowser({
  kind,
  namespace,
  name,
  ports = [],
  dark = false,
}: {
  kind: string;
  namespace: string;
  name: string;
  /** Candidate ports; empty lets the engine pick the declared one. */
  ports?: number[];
  /** The canvas dock is always dark; the Deployed page follows the theme. */
  dark?: boolean;
}) {
  const [port, setPort] = useState(ports[0] ?? 0);
  const tunnel = useForwards().find(f => f.kind === kind && f.namespace === namespace && f.name === name);
  const [busy, setBusy] = useState(false);
  const btn = dark
    ? "inline-flex items-center gap-1.5 rounded border border-neutral-700 px-2.5 py-1.5 text-xs text-gray-300 hover:border-neutral-600 hover:text-gray-100 disabled:opacity-50"
    : button;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      notifyError(errorMessage(err));
    } finally {
      setBusy(false);
      tunnelsChanged();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {ports.length > 1 && !tunnel && (
        <select className={input} value={port} onChange={e => setPort(Number(e.target.value))} aria-label="Port">
          {ports.map(p => (
            <option key={p} value={p}>
              port {p}
            </option>
          ))}
        </select>
      )}
      {tunnel ? (
        <>
          <a href={tunnel.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-blue-500 hover:underline">
            {tunnel.url}
          </a>
          <button className={btn} disabled={busy} onClick={() => act(() => stopForward(tunnel.id).then(() => {}))}>
            <X className="h-3.5 w-3.5" /> Stop
          </button>
        </>
      ) : (
        <>
          <button
            className={btn}
            disabled={busy}
            title="Open a tunnel from this computer to it (kubectl port-forward)"
            onClick={() =>
              act(async () => {
                const f = await startForward(kind, namespace, name, port || undefined);
                window.open(f.url, "_blank", "noopener");
              })
            }
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />} Open in browser
          </button>
          <span className="text-xs text-gray-500">Tunnels one port of it to localhost.</span>
        </>
      )}
    </div>
  );
}

function SecretValues({ r }: { r: K8sResource }) {
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);

  if (!values) {
    return (
      <button
        className={button}
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          try {
            setValues(await revealSecret(r.namespace, r.name));
          } catch (err) {
            notifyError(errorMessage(err));
          } finally {
            setLoading(false);
          }
        }}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Reveal values
      </button>
    );
  }
  return (
    <dl className="space-y-1 text-xs">
      {Object.entries(values).map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <dt className="min-w-[120px] font-mono text-gray-500">{k}</dt>
          <dd className="flex min-w-0 items-center gap-2">
            <code className="truncate rounded bg-gray-100 px-1.5 py-0.5 dark:bg-neutral-800 dark:text-gray-200">{v}</code>
            <button
              aria-label={`Copy ${k}`}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              onClick={() => navigator.clipboard.writeText(v).then(() => notify(`Copied ${k}`, "success"))}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </dd>
        </div>
      ))}
      <button className="text-xs text-gray-500 hover:underline" onClick={() => setValues(null)}>
        Hide
      </button>
    </dl>
  );
}

function ScaleControl({ r, busy, run, spin }: { r: K8sResource } & Runner) {
  const [replicas, setReplicas] = useState(r.replicas ?? 1);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        min={0}
        max={100}
        value={replicas}
        onChange={e => setReplicas(Number(e.target.value))}
        className={`${input} w-20`}
        aria-label="Replicas"
      />
      <button
        className={button}
        disabled={busy !== null || replicas === r.replicas}
        onClick={() =>
          run("scale", async () => {
            const res = await workloadAction("scale", r.kind, r.namespace, r.name, replicas);
            notify(res.message, "success");
          })
        }
      >
        {spin("scale", Scale)} Scale
      </button>
      <span className="text-xs text-gray-500">0 stops it without deleting anything.</span>
    </div>
  );
}

/** One command, not an interactive shell — which covers most reasons to want one. */
function RunCommand({ r }: { r: K8sResource }) {
  const containers = r.containers ?? [];
  const [container, setContainer] = useState(containers[0]?.name ?? "");
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const go = async () => {
    if (!command.trim() || running) return;
    setRunning(true);
    try {
      const res = await execInPod(r.namespace, r.name, command, container || undefined);
      setOutput((res.output || "(no output)") + (res.exitError ? `\n\n[${res.exitError}]` : ""));
    } catch (err) {
      setOutput(errorMessage(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Terminal className="h-3.5 w-3.5 text-gray-400" />
        {containers.length > 1 && (
          <select className={input} value={container} onChange={e => setContainer(e.target.value)} aria-label="Container">
            {containers.map(c => (
              <option key={c.name}>{c.name}</option>
            ))}
          </select>
        )}
        <input
          className={`${input} min-w-[220px] flex-1 font-mono`}
          placeholder="e.g. env, ls /etc, cat /etc/os-release"
          value={command}
          onChange={e => setCommand(e.target.value)}
          onKeyDown={e => e.key === "Enter" && go()}
          aria-label="Command to run in the container"
        />
        <button className={button} disabled={running || !command.trim()} onClick={go}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run
        </button>
      </div>
      {output !== null && (
        <pre className="max-h-64 overflow-auto rounded bg-neutral-950 p-2 text-[11px] leading-relaxed text-gray-200">{output}</pre>
      )}
    </div>
  );
}

function Permissions({ r }: { r: K8sResource }) {
  const [perms, setPerms] = useState<Permission[] | null>(null);
  const [loading, setLoading] = useState(false);

  if (!perms) {
    return (
      <button
        className={button}
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          try {
            setPerms(await fetchPermissions(r.namespace, r.name));
          } catch (err) {
            notifyError(errorMessage(err));
          } finally {
            setLoading(false);
          }
        }}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />} What can it do?
      </button>
    );
  }
  if (perms.length === 0) {
    return <p className="text-xs text-gray-500">Nothing: no Role or ClusterRole is bound to it, so its pods cannot call the Kubernetes API.</p>;
  }
  return (
    <table className="w-full text-left text-xs">
      <thead className="text-gray-500">
        <tr>
          <th className="py-1 pr-3 font-medium">Can</th>
          <th className="py-1 pr-3 font-medium">On</th>
          <th className="py-1 pr-3 font-medium">Where</th>
          <th className="py-1 font-medium">Granted by</th>
        </tr>
      </thead>
      <tbody className="text-gray-700 dark:text-gray-300">
        {perms.map((p, i) => (
          <tr key={i} className="border-t border-gray-100 dark:border-neutral-800">
            <td className="py-1 pr-3 font-mono">{p.verbs.join(", ")}</td>
            <td className="py-1 pr-3 font-mono">{p.resources.join(", ")}</td>
            <td className="py-1 pr-3">{p.namespace || "whole cluster"}</td>
            <td className="py-1 text-gray-500">{p.source}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function JobHistory({ jobs }: { jobs: K8sResource[] }) {
  if (jobs.length === 0) return <p className="text-xs text-gray-500">No runs yet — the first starts at the next scheduled time.</p>;
  const recent = [...jobs].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, 10);
  return (
    <div className="text-xs">
      <p className="mb-1 font-medium text-gray-600 dark:text-gray-400">Recent runs</p>
      <ul className="space-y-0.5">
        {recent.map(j => (
          <li key={j.uid} className="flex gap-3">
            <span className="text-gray-500" title={localTime(j.createdAt)}>{age(j.createdAt)} ago</span>
            <span className="font-mono text-gray-700 dark:text-gray-300">{j.name}</span>
            <span className={j.status === "Failed" ? "text-red-500" : "text-gray-500"}>{j.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
