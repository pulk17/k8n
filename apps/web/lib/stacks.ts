import type { K8sResource } from "./api";

export interface StackSummary {
  name: string;
  source: "helm" | "k8n" | "label";
  namespaces: string[];
  /** Everything in it, pods included. */
  count: number;
  /** The objects worth naming: workloads first. */
  workloads: string[];
}

const WORKLOADS = ["Deployment", "StatefulSet", "DaemonSet", "CronJob", "Job"];

/** The stacks in a resource list, largest first; ungrouped resources are left out. */
export function summarizeStacks(resources: K8sResource[]): StackSummary[] {
  const by = new Map<string, StackSummary>();
  for (const r of resources) {
    if (!r.stack || r.protected) continue;
    const s = by.get(r.stack) ?? {
      name: r.stack,
      source: r.stackSource ?? "label",
      namespaces: [],
      count: 0,
      workloads: [],
    };
    s.count++;
    if (!s.namespaces.includes(r.namespace)) s.namespaces.push(r.namespace);
    if (WORKLOADS.includes(r.kind)) s.workloads.push(`${r.kind} ${r.name}`);
    // A release is Helm's whichever of its objects is seen first.
    if (r.stackSource === "helm") s.source = "helm";
    by.set(r.stack, s);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const STACK_SOURCE_LABEL: Record<StackSummary["source"], string> = {
  helm: "Helm release",
  k8n: "Applied from k8n",
  label: "Labelled app",
};
