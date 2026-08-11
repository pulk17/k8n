// Single source of truth for all resource colors and connection types.
// Every component and store MUST import from here — never define inline.

// Colour is meaning, in two independent systems:
//
//   RESOURCE_COLORS  — what a node *is*.  One hue family per category, so the
//                      canvas groups visually without anyone reading a label.
//   CONNECTION_TYPES — what an edge *does*.  Eight hues chosen to stay apart at
//                      the 14px handle size, on the dark canvas.
//
// The two palettes deliberately do not share values: a yellow node next to a
// yellow wire used to imply a relationship that was not there.

/** Node accent per kind. Grouped by category — see the comment above. */
export const RESOURCE_COLORS: Record<string, string> = {
  // Workloads — blue
  Deployment: "#3b82f6",
  ReplicaSet: "#60a5fa",
  Pod: "#93c5fd",
  StatefulSet: "#6366f1",
  DaemonSet: "#818cf8",

  // Batch — teal
  Job: "#14b8a6",
  CronJob: "#0d9488",

  // Networking — green and pink
  Service: "#22c55e",
  Ingress: "#ec4899",

  // Configuration — amber
  ConfigMap: "#f59e0b",
  Secret: "#f97316",

  // Storage — purple
  PersistentVolumeClaim: "#a855f7",
  PersistentVolume: "#7e22ce",

  // Identity, access and policy — slate, with red for the one that denies
  ServiceAccount: "#64748b",
  Role: "#64748b",
  ClusterRole: "#475569",
  RoleBinding: "#64748b",
  ClusterRoleBinding: "#475569",
  NetworkPolicy: "#ef4444",

  // Scaling — cyan
  HorizontalPodAutoscaler: "#06b6d4",
  VerticalPodAutoscaler: "#0891b2",

  // Everything else
  Namespace: "#71717a",
  HelmRelease: "#f43f5e",
};

/** Default for kinds k8n has no model for, which in practice means CRDs. */
export const DEFAULT_RESOURCE_COLOR = "#94a3b8";

/** Badge styling per reported resource status. `Unknown` is the fallback. */
export const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  Running: { bg: "bg-green-50 dark:bg-green-950/20", text: "text-green-700 dark:text-green-400", dot: "bg-green-500" },
  Ready: { bg: "bg-green-50 dark:bg-green-950/20", text: "text-green-700 dark:text-green-400", dot: "bg-green-500" },
  Active: { bg: "bg-green-50 dark:bg-green-950/20", text: "text-green-700 dark:text-green-400", dot: "bg-green-500" },
  Completed: { bg: "bg-blue-50 dark:bg-blue-950/20", text: "text-blue-700 dark:text-blue-400", dot: "bg-blue-500" },
  Succeeded: { bg: "bg-blue-50 dark:bg-blue-950/20", text: "text-blue-700 dark:text-blue-400", dot: "bg-blue-500" },
  Pending: { bg: "bg-yellow-50 dark:bg-yellow-950/20", text: "text-yellow-700 dark:text-yellow-400", dot: "bg-yellow-500" },
  NotReady: { bg: "bg-yellow-50 dark:bg-yellow-950/20", text: "text-yellow-700 dark:text-yellow-400", dot: "bg-yellow-500" },
  Failed: { bg: "bg-red-50 dark:bg-red-950/20", text: "text-red-700 dark:text-red-400", dot: "bg-red-500" },
  Error: { bg: "bg-red-50 dark:bg-red-950/20", text: "text-red-700 dark:text-red-400", dot: "bg-red-500" },
  Unknown: { bg: "bg-gray-50 dark:bg-gray-950/20", text: "text-gray-600 dark:text-gray-400", dot: "bg-gray-400" },
};

/**
 * What an edge means. `label` is what the legend and the handle tooltip say.
 *
 * There used to be a `workload` type no rule ever produced, and `config` and
 * `helm` were both yellow-orange — indistinguishable on a 14px socket.
 */
export const CONNECTION_TYPES = {
  network: { color: "#22c55e", label: "Traffic" },
  routing: { color: "#6366f1", label: "Ingress" },
  config: { color: "#f59e0b", label: "Configuration" },
  storage: { color: "#a855f7", label: "Storage" },
  scaling: { color: "#06b6d4", label: "Scaling" },
  security: { color: "#ef4444", label: "Identity & policy" },
  helm: { color: "#ec4899", label: "Helm" },
  ownership: { color: "#71717a", label: "Owned by" },
} as const;

// Connection rules used to live here as a second, hand-maintained copy of what
// the node handles declared — which is how outputs ended up with no matching
// inputs. They now live in lib/connections.ts and both directions are derived
// from one table. Import isValidConnection / validTargetsFor from there.
