"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { errorMessage, fetchIngressClasses, installHelmChart } from "../lib/api";
import { confirmAction, notify, notifyError } from "../lib/dialog";

/**
 * Cluster add-ons k8n features lean on, installed through the Helm path it
 * already has. The values are the ones a laptop cluster needs: kubelets there
 * serve self-signed certificates, and nothing hands out load balancers.
 */
export const ADDONS = {
  "metrics-server": {
    label: "metrics-server",
    why: "CPU and memory figures, kubectl top and autoscaling all read from it.",
    chart: {
      releaseName: "metrics-server",
      chart: "metrics-server",
      repoUrl: "https://kubernetes-sigs.github.io/metrics-server/",
      namespace: "kube-system",
      valuesYaml: "args:\n  - --kubelet-insecure-tls\n",
    },
  },
  "ingress-nginx": {
    label: "ingress-nginx",
    why: "Serves Ingress objects. Without a controller an Ingress is accepted and then does nothing.",
    chart: {
      releaseName: "ingress-nginx",
      chart: "ingress-nginx",
      repoUrl: "https://kubernetes.github.io/ingress-nginx",
      namespace: "ingress-nginx",
      valuesYaml: "controller:\n  service:\n    type: NodePort\n",
    },
  },
} as const;

export type AddonName = keyof typeof ADDONS;

export default function InstallAddon({ name, onInstalled }: { name: AddonName; onInstalled?: () => void }) {
  const addon = ADDONS[name];
  const [busy, setBusy] = useState(false);

  const install = async () => {
    const ok = await confirmAction({
      title: `Install ${addon.label}?`,
      message: `${addon.why}\n\nInstalls the ${addon.chart.chart} Helm chart into the ${addon.chart.namespace} namespace. Uninstall it any time from the Helm releases list.`,
      confirmLabel: "Install",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await installHelmChart({ ...addon.chart });
      notify(`${addon.label} installed. It takes a minute to start.`, "success");
      onInstalled?.();
    } catch (err) {
      notifyError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={install}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded border border-blue-600/50 px-2.5 py-1 text-xs text-blue-400 hover:bg-blue-950/30 disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      Install {addon.label}
    </button>
  );
}

/**
 * Shown on an Ingress: whether anything in the cluster will act on it. The
 * answer is "no" on a fresh Docker Desktop or kind cluster, and nothing else
 * says so — the Ingress applies cleanly and simply never routes.
 */
export function IngressControllerCheck() {
  const [classes, setClasses] = useState<string[] | null>(null);

  useEffect(() => {
    // Unknown (offline, no cluster) stays null and shows nothing.
    fetchIngressClasses().then(setClasses).catch(() => {});
  }, []);

  if (classes === null || classes.length > 0) return null;

  return (
    <div className="rounded border border-yellow-900/50 bg-yellow-950/20 p-2.5">
      <p className="text-[11px] font-medium text-gray-200">This cluster has no ingress controller</p>
      <p className="mt-1 text-[10px] leading-relaxed text-gray-400">
        An Ingress is only a routing rule; a controller is the program that carries it out. Without one this Ingress
        will apply and then do nothing. On a laptop cluster, reach the controller afterwards with Open in browser on
        its Service in Deployed.
      </p>
      <div className="mt-2">
        <InstallAddon name="ingress-nginx" onInstalled={() => fetchIngressClasses().then(setClasses)} />
      </div>
    </div>
  );
}
