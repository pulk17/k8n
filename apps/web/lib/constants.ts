// Single source of truth for all resource colors and connection types.
// Every component and store MUST import from here — never define inline.

/** Color map for Kubernetes resource kinds used in node rendering */
export const RESOURCE_COLORS: Record<string, string> = {
  Deployment: "#3b82f6",
  Service: "#22c55e",
  Pod: "#6b7280",
  ConfigMap: "#eab308",
  Secret: "#ef4444",
  ReplicaSet: "#8b5cf6",
  StatefulSet: "#06b6d4",
  DaemonSet: "#f59e0b",
  Job: "#10b981",
  CronJob: "#14b8a6",
  Ingress: "#ec4899",
  HelmRelease: "#f59e0b",
  PersistentVolumeClaim: "#8b5cf6",
  PersistentVolume: "#7c3aed",
  Namespace: "#6366f1",
  ServiceAccount: "#6366f1",
  Role: "#6366f1",
  RoleBinding: "#6366f1",
  ClusterRole: "#7c3aed",
  ClusterRoleBinding: "#7c3aed",
  NetworkPolicy: "#ef4444",
  HorizontalPodAutoscaler: "#06b6d4",
  VerticalPodAutoscaler: "#06b6d4",
};

/** Default color when a kind is not in RESOURCE_COLORS */
export const DEFAULT_RESOURCE_COLOR = "#a855f7";

/** ComfyUI-style connection type definitions */
export const CONNECTION_TYPES = {
  workload: { color: "#3b82f6", label: "Workload" },
  config: { color: "#eab308", label: "Config" },
  network: { color: "#22c55e", label: "Network" },
  routing: { color: "#ec4899", label: "Routing" },
  storage: { color: "#8b5cf6", label: "Storage" },
  security: { color: "#ef4444", label: "Security" },
  scaling: { color: "#06b6d4", label: "Scaling" },
  helm: { color: "#f59e0b", label: "Helm" },
  ownership: { color: "#6b7280", label: "Ownership" },
} as const;

/** Valid connections map — single source of truth for connection validation */
export const VALID_CONNECTIONS: Record<string, string[]> = {
  Service: ["Deployment", "StatefulSet", "Pod", "ReplicaSet", "DaemonSet"],
  Ingress: ["Service"],
  ConfigMap: ["Deployment", "StatefulSet", "DaemonSet", "Pod", "Job", "CronJob"],
  Secret: ["Deployment", "StatefulSet", "DaemonSet", "Pod", "Job", "CronJob"],
  PersistentVolumeClaim: ["Deployment", "StatefulSet", "Pod"],
  PersistentVolume: ["PersistentVolumeClaim"],
  HorizontalPodAutoscaler: ["Deployment", "StatefulSet", "ReplicaSet"],
  VerticalPodAutoscaler: ["Deployment", "StatefulSet"],
  NetworkPolicy: ["Deployment", "StatefulSet", "Pod"],
  ServiceAccount: ["Deployment", "StatefulSet", "DaemonSet", "Pod", "Job", "CronJob"],
  Role: ["ServiceAccount", "RoleBinding"],
  ClusterRole: ["ServiceAccount", "ClusterRoleBinding"],
};
