import { Edge, Node } from "reactflow";
import { NodeData, fieldValue } from "./graph";
import { getConnectionType } from "./connections";

/**
 * The mistakes people actually make, caught while the graph is still a graph.
 *
 * This is the part of k8n a YAML editor cannot do. A Service whose selector
 * matches nothing is valid YAML, applies cleanly, reports Active, and then
 * every connection to it hangs — you find out minutes later, from the wrong
 * end. On a canvas the same mistake is a Service with nothing wired into it,
 * which is visible before anything is applied.
 *
 * Every check carries the reason, not just the verdict. `why` is the teaching;
 * `fix` is the next action. Both are shown, because knowing that an HPA needs
 * CPU requests is more useful than being told to add one.
 *
 * These run on the client on every graph change, so they must stay cheap and
 * must never need the cluster. Anything requiring the API server belongs in
 * the diagnose endpoint instead.
 */

export type IssueLevel = "warning" | "info";

export interface GraphIssue {
  nodeId: string;
  level: IssueLevel;
  /** Short enough for a one-line list. */
  title: string;
  /** Why this matters — the Kubernetes behaviour behind it. */
  why: string;
  /** What to do about it. */
  fix: string;
}

const WORKLOADS = new Set([
  "Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Pod", "Job", "CronJob",
]);

const str = (node: Node<NodeData>, key: string): string => {
  const value = fieldValue(node.data, key);
  return value === undefined ? "" : String(value).trim();
};

export function checkGraph(nodes: Node<NodeData>[], edges: Edge[]): GraphIssue[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const issues: GraphIssue[] = [];

  /** Neighbours of `id`, in the direction given, optionally of one type. */
  const neighbours = (id: string, direction: "out" | "in", type?: string) =>
    edges
      .filter(e => (direction === "out" ? e.source : e.target) === id)
      .map(e => byId.get(direction === "out" ? e.target : e.source))
      .filter((n): n is Node<NodeData> => {
        if (!n) return false;
        if (!type) return true;
        const [from, to] = direction === "out" ? [byId.get(id), n] : [n, byId.get(id)];
        return !!from && !!to && getConnectionType(from.data.kind, to.data.kind).type === type;
      });

  for (const node of nodes) {
    const { kind, name } = node.data;
    const add = (level: IssueLevel, title: string, why: string, fix: string) =>
      issues.push({ nodeId: node.id, level, title, why, fix });

    // Imported resources describe what is already running. Telling someone
    // their live cluster is missing a field they never typed is just noise.
    if (node.data.origin === "cluster") continue;

    if (WORKLOADS.has(kind) && kind !== "ReplicaSet" && !str(node, "image")) {
      add(
        "warning",
        `${name} has no container image`,
        "A workload with no image has nothing to run, so its pods stay in a create loop.",
        "Set the image field — for example nginx:1.27 or your own registry path."
      );
    }

    if (kind === "Service") {
      const targets = neighbours(node.id, "out", "network");
      if (targets.length === 0) {
        add(
          "warning",
          `${name} is not connected to a workload`,
          "A Service routes to pods matching its selector. With nothing wired in, it gets no endpoints — connections to it are accepted and then hang, which looks like a network problem rather than a config one.",
          "Drag from this Service's green socket to a Deployment, StatefulSet, DaemonSet or Pod."
        );
      }

      // port vs targetPort is the mistake that produces a healthy-looking
      // Service refusing every connection, so it is worth checking explicitly.
      const targetPort = str(node, "targetPort");
      for (const workload of targets) {
        const containerPort = str(workload, "containerPort");
        if (targetPort && containerPort && targetPort !== containerPort) {
          add(
            "warning",
            `${name} targets port ${targetPort}, but ${workload.data.name} listens on ${containerPort}`,
            "targetPort is the port on the container, not the port the Service publishes. If it does not match the container's port, the Service comes up healthy and every connection is refused.",
            `Set targetPort to ${containerPort}, or change the container port to ${targetPort}.`
          );
        }
      }
    }

    if (kind === "Ingress") {
      if (neighbours(node.id, "out", "routing").length === 0) {
        add(
          "warning",
          `${name} does not route to a Service`,
          "An Ingress is only a routing rule. With no Service behind it, requests that match the rule have nowhere to go.",
          "Connect this Ingress to a Service."
        );
      }
      if (!str(node, "host")) {
        add(
          "info",
          `${name} has no host`,
          "Without a host the rule matches every hostname that reaches the controller, which is rarely what you want once more than one app is running.",
          "Set a host such as app.example.com."
        );
      }
    }

    if (kind === "HorizontalPodAutoscaler") {
      const targets = neighbours(node.id, "out", "scaling");
      if (targets.length === 0) {
        add(
          "warning",
          `${name} has nothing to scale`,
          "An autoscaler needs a scaleTargetRef. On its own it has no workload to adjust.",
          "Connect it to a Deployment or StatefulSet."
        );
      }
      for (const target of targets) {
        if (!str(target, "cpuRequest")) {
          add(
            "warning",
            `${target.data.name} has no CPU request, so ${name} cannot scale it`,
            "An HPA's CPU target is a percentage of the container's request. With no request there is nothing to take a percentage of, so the metric reads as unknown and the replica count never moves.",
            "Set a CPU request on the workload — 100m is a reasonable starting point."
          );
        }
        // Both writing the replica count means every apply fights the HPA.
        if (str(target, "replicas")) {
          add(
            "info",
            `${target.data.name} sets replicas while ${name} manages them`,
            "The autoscaler and the manifest both own the replica count, so each apply resets whatever the HPA had settled on.",
            "Leave replicas unset on the workload and let the HPA own it."
          );
        }
      }
    }

    if (kind === "PersistentVolumeClaim" && neighbours(node.id, "out", "storage").length === 0) {
      add(
        "info",
        `${name} is not mounted by anything`,
        "The claim will be created and will reserve storage, but no pod will use it.",
        "Connect it to the workload that should mount it, or remove it."
      );
    }

    if ((kind === "ConfigMap" || kind === "Secret") && neighbours(node.id, "out", "config").length === 0) {
      add(
        "info",
        `${name} is not used by any workload`,
        `The ${kind} is created, but nothing reads it — configuration only reaches a pod through an env var or a mounted volume.`,
        "Connect it to the workload that needs it."
      );
    }

    if (kind === "NetworkPolicy" && neighbours(node.id, "out", "security").length === 0) {
      add(
        "info",
        `${name} selects no pods`,
        "A policy that selects nothing has no effect at all — and note that the moment it does select a pod, everything it does not explicitly allow becomes denied.",
        "Connect it to the workload it should apply to."
      );
    }

    if (kind === "CronJob" && !str(node, "schedule")) {
      add(
        "warning",
        `${name} has no schedule`,
        "A CronJob with no schedule never fires, so no Job is ever created.",
        "Set a cron expression, for example 0 3 * * * for 3am daily."
      );
    }
  }

  // Warnings first so the list opens on what actually breaks.
  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === "warning" ? -1 : 1));
}

/** Issues grouped by the node they belong to, for badging the cards. */
export function issuesByNode(issues: GraphIssue[]): Map<string, GraphIssue[]> {
  const map = new Map<string, GraphIssue[]>();
  for (const issue of issues) {
    const list = map.get(issue.nodeId);
    if (list) list.push(issue);
    else map.set(issue.nodeId, [issue]);
  }
  return map;
}
