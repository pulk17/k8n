// Per-kind field definitions for the node editor.
//
// The node body used to be a chain of `data.kind === '...'` blocks, which is why
// Job, CronJob, DaemonSet, NetworkPolicy and the RBAC kinds ended up with no
// editor at all and silently fell through to a spec textarea the compiler
// ignored. Adding a kind is now a table entry.

import { NodeData } from "./graph";

export type FieldType = "text" | "number" | "select" | "textarea" | "checkbox";

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: string[];
  min?: number;
  max?: number;
  rows?: number;
  /** Shown under the input; use it to explain what an edge would do instead. */
  hint?: string;
  /** Only render when this predicate passes. */
  visibleWhen?: (data: NodeData) => boolean;
}

const IMAGE: FieldSpec = {
  key: "image",
  label: "Image",
  type: "text",
  placeholder: "nginx:latest",
};

const CONTAINER_PORT: FieldSpec = {
  key: "containerPort",
  label: "Container Port",
  type: "number",
  min: 1,
  max: 65535,
};

const COMMAND: FieldSpec = {
  key: "command",
  label: "Command",
  type: "text",
  placeholder: "sh -c 'echo hello'",
  hint: "Overrides the image entrypoint. Quoted arguments stay together.",
};

const ARGS: FieldSpec = {
  key: "args",
  label: "Args",
  type: "text",
  placeholder: "--verbose --port=8080",
};

const RESOURCES: FieldSpec[] = [
  { key: "cpuRequest", label: "CPU Request", type: "text", placeholder: "100m" },
  { key: "cpuLimit", label: "CPU Limit", type: "text", placeholder: "500m" },
  { key: "memoryRequest", label: "Memory Request", type: "text", placeholder: "128Mi" },
  { key: "memoryLimit", label: "Memory Limit", type: "text", placeholder: "512Mi" },
];

const SERVICE_ACCOUNT_HINT: FieldSpec = {
  key: "serviceAccountName",
  label: "Service Account",
  type: "text",
  placeholder: "default",
  hint: "Or wire a ServiceAccount node into this workload.",
};

export const NODE_SCHEMA: Record<string, FieldSpec[]> = {
  Deployment: [
    { key: "replicas", label: "Replicas", type: "number", min: 0 },
    IMAGE,
    CONTAINER_PORT,
    COMMAND,
    ARGS,
    ...RESOURCES,
    SERVICE_ACCOUNT_HINT,
  ],

  StatefulSet: [
    { key: "replicas", label: "Replicas", type: "number", min: 0 },
    IMAGE,
    CONTAINER_PORT,
    {
      key: "serviceName",
      label: "Service Name",
      type: "text",
      placeholder: "headless-service",
      hint: "The headless Service governing this set. Defaults to the node name.",
    },
    COMMAND,
    ...RESOURCES,
    SERVICE_ACCOUNT_HINT,
  ],

  DaemonSet: [IMAGE, CONTAINER_PORT, COMMAND, ARGS, ...RESOURCES, SERVICE_ACCOUNT_HINT],

  Pod: [IMAGE, CONTAINER_PORT, COMMAND, ARGS, ...RESOURCES, SERVICE_ACCOUNT_HINT],

  Job: [
    IMAGE,
    COMMAND,
    ARGS,
    { key: "completions", label: "Completions", type: "number", min: 1 },
    { key: "parallelism", label: "Parallelism", type: "number", min: 1 },
    { key: "backoffLimit", label: "Backoff Limit", type: "number", min: 0 },
    ...RESOURCES,
  ],

  CronJob: [
    {
      key: "schedule",
      label: "Schedule",
      type: "text",
      placeholder: "0 0 * * *",
      hint: "Standard cron expression, in the cluster's timezone.",
    },
    IMAGE,
    COMMAND,
    ARGS,
    {
      key: "concurrencyPolicy",
      label: "Concurrency",
      type: "select",
      options: ["Allow", "Forbid", "Replace"],
    },
    ...RESOURCES,
  ],

  Service: [
    { key: "port", label: "Port", type: "number", min: 1, max: 65535 },
    {
      key: "targetPort",
      label: "Target Port",
      type: "number",
      min: 1,
      max: 65535,
      hint: "Leave empty to use the connected workload's container port.",
    },
    {
      key: "serviceType",
      label: "Type",
      type: "select",
      options: ["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"],
    },
    {
      key: "nodePort",
      label: "Node Port",
      type: "number",
      min: 30000,
      max: 32767,
      visibleWhen: d => d.serviceType === "NodePort",
    },
    { key: "protocol", label: "Protocol", type: "select", options: ["TCP", "UDP", "SCTP"] },
  ],

  Ingress: [
    { key: "host", label: "Host", type: "text", placeholder: "example.com" },
    { key: "path", label: "Path", type: "text", placeholder: "/" },
    {
      key: "pathType",
      label: "Path Type",
      type: "select",
      options: ["Prefix", "Exact", "ImplementationSpecific"],
    },
    { key: "ingressClassName", label: "Ingress Class", type: "text", placeholder: "nginx" },
    { key: "tlsEnabled", label: "Enable TLS", type: "checkbox" },
    {
      key: "tlsSecretName",
      label: "TLS Secret",
      type: "text",
      placeholder: "<name>-tls",
      visibleWhen: d => !!d.tlsEnabled,
    },
  ],

  ConfigMap: [
    {
      key: "configData",
      label: "Data",
      type: "textarea",
      rows: 4,
      placeholder: "KEY1=value1\nKEY2=value2",
      hint: "KEY=value per line. Text without '=' is stored as a single config file.",
    },
  ],

  Secret: [
    {
      key: "secretType",
      label: "Type",
      type: "select",
      options: [
        "Opaque",
        "kubernetes.io/tls",
        "kubernetes.io/dockerconfigjson",
        "kubernetes.io/basic-auth",
      ],
    },
    {
      key: "secretData",
      label: "Data",
      type: "textarea",
      rows: 3,
      placeholder: "username=admin\npassword=s3cret",
      hint: "Sent as stringData; the API server encodes it. Values are never sent to the AI.",
    },
  ],

  PersistentVolumeClaim: [
    { key: "storageSize", label: "Storage Size", type: "text", placeholder: "10Gi" },
    {
      key: "accessMode",
      label: "Access Mode",
      type: "select",
      options: ["ReadWriteOnce", "ReadOnlyMany", "ReadWriteMany", "ReadWriteOncePod"],
    },
    { key: "storageClass", label: "Storage Class", type: "text", placeholder: "standard" },
    {
      key: "mountPath",
      label: "Mount Path",
      type: "text",
      placeholder: "/data",
      hint: "Where connected workloads mount this volume.",
    },
    {
      key: "asVolumeClaimTemplate",
      label: "Per-replica volume (StatefulSet)",
      type: "checkbox",
      hint: "Emit as volumeClaimTemplate so each replica gets its own volume.",
    },
  ],

  PersistentVolume: [
    { key: "storageSize", label: "Capacity", type: "text", placeholder: "10Gi" },
    {
      key: "accessMode",
      label: "Access Mode",
      type: "select",
      options: ["ReadWriteOnce", "ReadOnlyMany", "ReadWriteMany"],
    },
    { key: "hostPath", label: "Host Path", type: "text", placeholder: "/mnt/data" },
    {
      key: "reclaimPolicy",
      label: "Reclaim Policy",
      type: "select",
      options: ["Retain", "Delete", "Recycle"],
    },
    { key: "storageClass", label: "Storage Class", type: "text", placeholder: "standard" },
  ],

  HorizontalPodAutoscaler: [
    { key: "minReplicas", label: "Min Replicas", type: "number", min: 1 },
    { key: "maxReplicas", label: "Max Replicas", type: "number", min: 1 },
    { key: "targetCPU", label: "Target CPU %", type: "number", min: 1, max: 100 },
    {
      key: "targetName",
      label: "Target",
      type: "text",
      placeholder: "connect to a workload",
      hint: "Set automatically from the workload this autoscaler is wired to.",
    },
  ],

  NetworkPolicy: [
    {
      key: "policyTypes",
      label: "Policy Types",
      type: "select",
      options: ["Ingress", "Egress", "Ingress,Egress"],
    },
    {
      key: "allowSameNamespace",
      label: "Allow same-namespace traffic",
      type: "checkbox",
      hint: "Otherwise this is a default-deny policy for the selected pods.",
    },
  ],

  ServiceAccount: [],

  Role: [
    { key: "apiGroups", label: "API Groups", type: "text", placeholder: "\"\", apps" },
    { key: "resources", label: "Resources", type: "text", placeholder: "pods, services" },
    { key: "verbs", label: "Verbs", type: "text", placeholder: "get, list, watch" },
  ],

  ClusterRole: [
    { key: "apiGroups", label: "API Groups", type: "text", placeholder: "\"\", apps" },
    { key: "resources", label: "Resources", type: "text", placeholder: "pods, services" },
    { key: "verbs", label: "Verbs", type: "text", placeholder: "get, list, watch" },
  ],

  RoleBinding: [
    {
      key: "roleName",
      label: "Role",
      type: "text",
      placeholder: "connect a Role",
      hint: "Set automatically from the Role wired into this binding.",
    },
  ],

  ClusterRoleBinding: [
    {
      key: "roleName",
      label: "Cluster Role",
      type: "text",
      placeholder: "connect a ClusterRole",
      hint: "Set automatically from the ClusterRole wired into this binding.",
    },
  ],

  HelmRelease: [
    { key: "chartVersion", label: "Version", type: "text", placeholder: "latest" },
    {
      key: "valuesYaml",
      label: "Custom Values (YAML)",
      type: "textarea",
      rows: 5,
      placeholder: "replicaCount: 3\nservice:\n  type: LoadBalancer",
    },
  ],
};

/** Fields for a kind; custom resources fall back to a raw spec editor. */
export function fieldsFor(kind: string): FieldSpec[] {
  if (NODE_SCHEMA[kind]) return NODE_SCHEMA[kind];
  return [
    {
      key: "apiVersion",
      label: "API Version",
      type: "text",
      placeholder: "example.com/v1",
      hint: "Required for custom resources.",
    },
    {
      key: "spec",
      label: "Spec (YAML)",
      type: "textarea",
      rows: 6,
      placeholder: "replicas: 1\nfoo: bar",
      hint: "Parsed as YAML and used verbatim as the resource spec.",
    },
  ];
}

/** True when k8n models this kind natively. */
export function isKnownKind(kind: string): boolean {
  return kind in NODE_SCHEMA;
}

/**
 * Starting values for a node dropped on the canvas, so it compiles to something
 * valid before the user has typed anything. Only fields the kind actually uses:
 * a ConfigMap has no replicas, and stray fields used to leak into the YAML.
 */
export function defaultsForKind(kind: string): Record<string, unknown> {
  switch (kind) {
    case "Deployment":
      return { replicas: 1, image: "nginx:latest", containerPort: 80 };
    case "StatefulSet":
      return { replicas: 1, image: "postgres:16-alpine", containerPort: 5432 };
    case "DaemonSet":
      return { image: "fluent/fluentd:latest", containerPort: 24224 };
    case "Pod":
      return { image: "nginx:latest", containerPort: 80 };
    case "Job":
      return { image: "busybox:latest", command: "sh -c 'echo hello'", backoffLimit: 3 };
    case "CronJob":
      return { image: "busybox:latest", command: "sh -c 'echo hello'", schedule: "0 0 * * *" };
    case "Service":
      return { port: 80, serviceType: "ClusterIP", protocol: "TCP" };
    case "Ingress":
      return { path: "/", pathType: "Prefix" };
    case "PersistentVolumeClaim":
      return { storageSize: "10Gi", accessMode: "ReadWriteOnce" };
    case "PersistentVolume":
      return { storageSize: "10Gi", accessMode: "ReadWriteOnce", hostPath: "/mnt/data" };
    case "HorizontalPodAutoscaler":
      return { minReplicas: 1, maxReplicas: 10, targetCPU: 80 };
    case "Secret":
      return { secretType: "Opaque" };
    case "NetworkPolicy":
      return { policyTypes: "Ingress" };
    case "Role":
    case "ClusterRole":
      return { resources: "pods", verbs: "get,list,watch" };
    default:
      return {};
  }
}
