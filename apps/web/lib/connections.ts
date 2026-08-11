// Single source of truth for what may connect to what.
//
// Handles, validation, edge colouring and backend compilation all derive from
// the rules below. Previously the node handles and the validation map were
// maintained separately, which let outputs exist with no matching input — HPA,
// PVC, ServiceAccount and NetworkPolicy all declared outputs that accepted
// Deployment while Deployment accepted none of them, so those edges could never
// be drawn at all. Deriving both directions from one table makes that
// impossible by construction.

import { CONNECTION_TYPES } from "./constants";

export type ConnectionType = keyof typeof CONNECTION_TYPES;

export interface ConnectionRule {
  type: ConnectionType;
  /** Kinds that emit this connection. */
  from: string[];
  /** Kinds that accept it. */
  to: string[];
  /** Verb shown on the source handle. */
  sourceLabel: string;
  /** Noun shown on the target handle. */
  targetLabel: string;
}

export const WORKLOAD_KINDS = [
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "ReplicaSet",
  "Pod",
  "Job",
  "CronJob",
] as const;

const PODDED_WORKLOADS = ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Pod"];

export const CONNECTION_RULES: ConnectionRule[] = [
  {
    type: "network",
    from: ["Service"],
    to: PODDED_WORKLOADS,
    sourceLabel: "Routes to",
    targetLabel: "Exposed by",
  },
  {
    type: "routing",
    from: ["Ingress"],
    to: ["Service"],
    sourceLabel: "Routes to",
    targetLabel: "Ingress",
  },
  {
    type: "config",
    from: ["ConfigMap", "Secret"],
    to: [...WORKLOAD_KINDS, "HelmRelease"],
    sourceLabel: "Config for",
    targetLabel: "Config",
  },
  {
    type: "storage",
    from: ["PersistentVolumeClaim"],
    to: ["Deployment", "StatefulSet", "DaemonSet", "Pod", "Job", "CronJob"],
    sourceLabel: "Volume for",
    targetLabel: "Storage",
  },
  {
    type: "storage",
    from: ["PersistentVolume"],
    to: ["PersistentVolumeClaim"],
    sourceLabel: "Provides",
    targetLabel: "Backed by",
  },
  {
    type: "scaling",
    from: ["HorizontalPodAutoscaler", "VerticalPodAutoscaler"],
    to: ["Deployment", "StatefulSet", "ReplicaSet"],
    sourceLabel: "Scales",
    targetLabel: "Autoscaler",
  },
  {
    type: "security",
    from: ["ServiceAccount"],
    to: [...WORKLOAD_KINDS],
    sourceLabel: "Identity for",
    targetLabel: "Identity",
  },
  {
    type: "security",
    from: ["NetworkPolicy"],
    to: PODDED_WORKLOADS,
    sourceLabel: "Restricts",
    targetLabel: "Policy",
  },
  {
    type: "security",
    from: ["Role", "ClusterRole", "ServiceAccount"],
    to: ["RoleBinding", "ClusterRoleBinding"],
    sourceLabel: "Binds",
    targetLabel: "Binds",
  },
  {
    type: "helm",
    from: ["HelmRelease"],
    to: ["Deployment", "StatefulSet", "Service", "Ingress", "ConfigMap", "Secret"],
    sourceLabel: "Deploys",
    targetLabel: "Deployed by",
  },
];

export interface HandleSpec {
  type: ConnectionType;
  color: string;
  label: string;
  /** Kinds on the other end of this handle, for the tooltip. */
  kinds: string[];
}

function dedupeByType(specs: HandleSpec[]): HandleSpec[] {
  // One handle per connection type: a kind that can bind both Roles and
  // ServiceAccounts still shows a single "security" socket.
  const merged = new Map<ConnectionType, HandleSpec>();
  for (const spec of specs) {
    const existing = merged.get(spec.type);
    if (existing) {
      existing.kinds = Array.from(new Set([...existing.kinds, ...spec.kinds]));
    } else {
      merged.set(spec.type, { ...spec, kinds: [...spec.kinds] });
    }
  }
  return Array.from(merged.values());
}

/** Output handles (right side) for a kind. */
export function outputsFor(kind: string): HandleSpec[] {
  return dedupeByType(
    CONNECTION_RULES.filter(r => r.from.includes(kind)).map(r => ({
      type: r.type,
      color: CONNECTION_TYPES[r.type].color,
      label: r.sourceLabel,
      kinds: r.to,
    }))
  );
}

/** Input handles (left side) for a kind. */
export function inputsFor(kind: string): HandleSpec[] {
  return dedupeByType(
    CONNECTION_RULES.filter(r => r.to.includes(kind)).map(r => ({
      type: r.type,
      color: CONNECTION_TYPES[r.type].color,
      label: r.targetLabel,
      kinds: r.from,
    }))
  );
}

/** Whether an edge from sourceKind to targetKind is allowed. */
export function isValidConnection(sourceKind: string, targetKind: string): boolean {
  return CONNECTION_RULES.some(r => r.from.includes(sourceKind) && r.to.includes(targetKind));
}

/** Every kind sourceKind is allowed to connect to — used in error messages. */
export function validTargetsFor(sourceKind: string): string[] {
  const targets = new Set<string>();
  for (const rule of CONNECTION_RULES) {
    if (rule.from.includes(sourceKind)) rule.to.forEach(t => targets.add(t));
  }
  return Array.from(targets);
}

/** The connection type and colour for an edge between two kinds. */
export function getConnectionType(
  sourceKind: string,
  targetKind: string
): { type: ConnectionType; color: string } {
  const rule = CONNECTION_RULES.find(
    r => r.from.includes(sourceKind) && r.to.includes(targetKind)
  );
  const type: ConnectionType = rule ? rule.type : "ownership";
  return { type, color: CONNECTION_TYPES[type].color };
}

/** Edges that carry live traffic are animated; structural ones are not. */
export function isAnimatedType(type: ConnectionType): boolean {
  return type === "network" || type === "routing";
}
