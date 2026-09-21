// API_URL is empty by default so the browser talks to the Next.js origin and
// next.config.ts proxies /api/* to the Go backend. Same-origin means no CORS in
// the normal path; set NEXT_PUBLIC_API_URL only when pointing at a backend on a
// different host.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

import { TOKEN_HEADER, getToken, reportUnauthorized, withToken } from "./session";

export interface ContainerSummary {
  name: string;
  image: string;
}

/** Step 1..4: find a node, download the image, start it, pass the health check. */
export interface Startup {
  step: number;
  label: string;
  /** RFC3339, when the current step began. */
  since?: string;
}

export interface K8sResource {
  kind: string;
  name: string;
  namespace: string;
  labels: Record<string, string>;
  annotations?: Record<string, string>;
  status: string;
  statusMessage?: string;
  uid: string;
  selector?: Record<string, string>;
  ownerReferences?: string[];
  createdAt?: string;
  /** Cluster machinery. The API refuses to delete these. */
  protected?: boolean;

  replicas?: number;
  readyReplicas?: number;
  image?: string;
  containers?: ContainerSummary[];

  serviceType?: string;
  clusterIP?: string;
  externalIP?: string;
  ports?: string[];

  podIP?: string;
  nodeName?: string;
  restartCount?: number;
  /** What it belongs to: a Helm release, a k8n workflow, or a part-of label. */
  stack?: string;
  stackSource?: "helm" | "k8n" | "label";
  /** Where a pod that is not ready yet has got to; on a workload, its slowest pod. */
  startup?: Startup;

  dataKeys?: string[];

  // Real references, used to derive edges.
  configMapRefs?: string[];
  secretRefs?: string[];
  pvcRefs?: string[];
  serviceAccountName?: string;
  backends?: string[];
  hosts?: string[];
  scaleTargetKind?: string;
  scaleTargetName?: string;
  minReplicas?: number;
  maxReplicas?: number;
  storageSize?: string;
  accessMode?: string;
}

export interface CompileNote {
  nodeId?: string;
  name?: string;
  kind?: string;
  level: "info" | "warning";
  message: string;
}

export interface CompileResult {
  yaml: string;
  /** What the graph's Helm charts render to. Shown for review, never applied
   *  as plain YAML — the charts are installed as releases instead. */
  helmYaml?: string;
  objects: number;
  notes: CompileNote[];
}

function formatErrorDetails(details: unknown): string {
  if (!details) return "";
  if (typeof details === "string") return details.trim();
  if (Array.isArray(details)) {
    return details
      .map(detail => {
        if (!detail || typeof detail !== "object") return String(detail);
        const item = detail as { resource?: string; message?: string };
        return [item.resource, item.message].filter(Boolean).join(": ");
      })
      .filter(Boolean)
      .join("; ");
  }
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

/** The message to show a user for anything thrown, including API hints/details. */
export const errorMessage = (err: unknown) => {
  if (!(err instanceof Error)) return String(err);
  const details = formatErrorDetails((err as Error & { details?: unknown }).details);
  return details && !err.message.includes(details) ? `${err.message}: ${details}` : err.message;
};

export const CLUSTER_DOWN =
  "Kubernetes isn't answering. Start it (Docker Desktop → Settings → Kubernetes, or your own cluster) and try again.";

/** Whether an error is the cluster being down rather than anything k8n did. */
export const isClusterDown = (text: string) =>
  /cluster unreachable|connection refused|actively refused|no route to host|dial tcp .* i\/o timeout/i.test(text);

/** Only a genuine transport failure means the API is unreachable. */
function isNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    (error.message === "Failed to fetch" ||
      error.message.includes("NetworkError") ||
      error.message.includes("network"))
  );
}

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  /** Returned instead of throwing when the response is 404. */
  signal?: AbortSignal;
}

/**
 * One place for fetch, timeouts and error shaping, so every caller reports
 * failures the same way instead of each rolling its own try/catch.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, timeoutMs = 20000 } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Honour an externally supplied signal alongside our timeout.
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    // Every call carries the pairing token. It goes in a header rather than the
    // URL so it stays out of logs and out of the address bar.
    const headers: Record<string, string> = {};
    if (body) headers["Content-Type"] = "application/json";
    const token = getToken();
    if (token) headers[TOKEN_HEADER] = token;

    const res = await fetch(`${API_URL}${path}`, {
      method,
      signal: controller.signal,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Not paired, or paired with a k8n that has since regenerated its token.
    // The UI asks for a new one rather than showing a wall of failed requests.
    if (res.status === 401) reportUnauthorized();

    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      let details: unknown;
      const text = await res.text().catch(() => "");
      if (text) {
        try {
          const parsed = JSON.parse(text);
          message = parsed.error || parsed.message || message;
          details = parsed.details || parsed.hint;
        } catch {
          details = text;
        }
      }
      // A stopped cluster surfaces as a dial error from deep inside whichever
      // call noticed first. Every screen gets the same plain sentence instead.
      if (isClusterDown(`${message} ${formatErrorDetails(details)}`)) {
        throw new ApiError(CLUSTER_DOWN, res.status);
      }
      throw new ApiError(message, res.status, details);
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "Request timed out. Your cluster may be slow to respond — try selecting a single namespace."
      );
    }
    if (isNetworkError(error)) {
      throw new Error(
        `Cannot connect to the k8n API${API_URL ? ` at ${API_URL}` : ""}. Make sure the backend is running.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Is there an engine at all?
 *
 * /health needs no pairing token, which makes it the one honest way for a page
 * to find out whether it is talking to a running k8n — a hosted copy of this
 * page with nothing behind it looks exactly like a k8n that has stopped.
 */
export const fetchHealth = () =>
  request<{ status: string; kubernetes: string; database: string; version?: string; context?: string }>("/health", {
    timeoutMs: 5000,
  });

/** What k8n has changed on this machine, newest first. */
export interface ChangeEntry {
  at: string;
  cluster?: string;
  action: string;
  targets?: string[];
  detail?: string;
}

export const fetchHistory = (limit = 50) =>
  request<{ changes: ChangeEntry[] }>(`/api/history?limit=${limit}`).then(r => r?.changes ?? []);

export const fetchResources = (namespace?: string) =>
  request<K8sResource[]>(
    `/api/cluster/resources${namespace && namespace !== "all" ? `?namespace=${encodeURIComponent(namespace)}` : ""}`
  ).then(r => r ?? []);

/**
 * Live cluster state. Calls back with the full list every time something moves,
 * and returns a function that closes the stream.
 *
 * The server sends a snapshot first and only changes after that; the merging
 * happens here so callers never have to think about it.
 */
export function watchResources(
  namespace: string | undefined,
  onChange: (resources: K8sResource[]) => void,
  onError: (message: string) => void
): () => void {
  const query =
    namespace && namespace !== "all" ? `?namespace=${encodeURIComponent(namespace)}` : "";
  // EventSource cannot set headers, so this one carries the token in the query.
  // The server redacts it from its request log.
  const source = new EventSource(withToken(`${API_URL}/api/cluster/watch${query}`));
  const byUid = new Map<string, K8sResource>();

  source.onmessage = event => {
    const message = JSON.parse(event.data) as {
      type: string;
      changed?: K8sResource[];
      removed?: string[];
      message?: string;
    };

    if (message.type === "error") {
      onError(message.message || "The cluster stream failed.");
      return;
    }

    for (const resource of message.changed || []) byUid.set(resource.uid, resource);
    for (const uid of message.removed || []) byUid.delete(uid);

    // The server sorts its snapshot; re-sort here because merging by uid does
    // not preserve that, and rows must not jump around between updates.
    onChange(
      [...byUid.values()].sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) ||
          a.namespace.localeCompare(b.namespace) ||
          a.name.localeCompare(b.name)
      )
    );
  };

  // EventSource retries by itself after a dropped connection, but gives up when
  // the response was never a stream — no cluster connected, backend down. It
  // also never exposes that response, so the actual reason has to be asked for
  // separately; otherwise "no cluster connected" reads as a network blip.
  source.onerror = () => {
    if (source.readyState !== EventSource.CLOSED) return;
    fetchResources(namespace)
      .then(() => onError("Lost the connection to the cluster."))
      .catch(err => onError(errorMessage(err)));
  };

  return () => source.close();
}

export const fetchNamespaces = () =>
  request<string[]>("/api/cluster/namespaces").then(r => r ?? []);

/** A pod's recent log output. `previous` reads the crashed container instead. */
export const fetchPodLogs = (
  namespace: string,
  pod: string,
  opts: { tailLines?: number; previous?: boolean; container?: string } = {}
) => {
  const query = new URLSearchParams({ tailLines: String(opts.tailLines ?? 200) });
  if (opts.previous) query.set("previous", "true");
  if (opts.container) query.set("container", opts.container);
  return request<{ pod: string; namespace: string; container: string; logs: string }>(
    `/api/logs/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}?${query}`
  );
};

export interface ClusterEvent {
  type: string;
  reason: string;
  message: string;
  object: string;
  count: number;
  firstSeen?: string;
  lastSeen?: string;
}

/** Events for a namespace, or for one object and whatever it owns. */
export const fetchEvents = (namespace: string, object?: string) => {
  const query = new URLSearchParams({ limit: "50" });
  if (object) query.set("object", object);
  return request<ClusterEvent[]>(
    `/api/events/${encodeURIComponent(namespace)}?${query}`
  ).then(r => r ?? []);
};

export interface Finding {
  severity: "critical" | "warning" | "info";
  kind: string;
  name: string;
  reason: string;
  detail: string;
  hint?: string;
}

export interface DiagnosisReport {
  namespace: string;
  findings: Finding[];
  checked: number;
}

/** Deterministic health checks. This needs no AI key. */
export const fetchDiagnosis = (namespace: string) =>
  request<DiagnosisReport>(`/api/diagnose/${encodeURIComponent(namespace)}`);

export const fetchCRDs = () =>
  request<{ kind: string; name: string; group: string; version: string }[]>(
    "/api/cluster/crds"
  ).then(r => r ?? []);

export interface HelmChart {
  name: string;
  description: string;
  version?: string;
  repository?: { name: string; url: string };
}

/** What install, upgrade and template all take. */
export interface ChartRequest {
  releaseName: string;
  chart: string;
  repoUrl?: string;
  version?: string;
  namespace: string;
  valuesYaml?: string;
}

export interface HelmRelease {
  name: string;
  namespace: string;
  revision: number;
  updated: string;
  status: string;
  chart: string;
  chartVersion: string;
  appVersion: string;
  description: string;
  /** Where the chart came from, when k8n installed it. */
  repoUrl?: string;
  /** The values it is running with. */
  valuesYaml?: string;
}

export const searchHelmCharts = (query: string) =>
  request<HelmChart[]>(`/api/helm/search?q=${encodeURIComponent(query)}`).then(r => r ?? []);

export const installHelmChart = (params: ChartRequest) =>
  request<HelmRelease>("/api/helm/install", { method: "POST", body: params, timeoutMs: 180000 });

/**
 * Renders a chart to YAML without touching the cluster.
 *
 * The manifest preview gets this from the compiler (as `helmYaml`), but a node
 * needs it on its own, the moment it is dropped: a chart is the one resource
 * whose contents you cannot guess from the card.
 */
export const templateHelmChart = (params: ChartRequest) =>
  request<{ yaml: string }>("/api/helm/template", {
    method: "POST",
    body: params,
    timeoutMs: 120000,
  }).then(r => r?.yaml ?? "");

/** A chart's own values.yaml — every setting it offers, with its comments. */
export const fetchChartValues = (params: Omit<ChartRequest, "releaseName" | "namespace" | "valuesYaml">) =>
  request<{ values: string }>("/api/helm/values", {
    method: "POST",
    body: { ...params, releaseName: "values", namespace: "default" },
    timeoutMs: 120000,
  }).then(r => r?.values ?? "");

export const fetchHelmReleases = () =>
  request<HelmRelease[]>("/api/helm/releases").then(r => r ?? []);

export const fetchHelmHistory = (name: string, namespace: string) =>
  request<HelmRelease[]>(
    `/api/helm/releases/${name}/history?namespace=${encodeURIComponent(namespace)}`
  ).then(r => r ?? []);

export const uninstallHelmRelease = (name: string, namespace: string) =>
  request<{ message: string }>(
    `/api/helm/releases/${name}?namespace=${encodeURIComponent(namespace)}`,
    { method: "DELETE", timeoutMs: 60000 }
  );

export const upgradeHelmRelease = (release: HelmRelease, valuesYaml: string) =>
  request<HelmRelease>(`/api/helm/releases/${release.name}/upgrade`, {
    method: "POST",
    body: {
      releaseName: release.name,
      chart: release.chart,
      version: release.chartVersion,
      namespace: release.namespace,
      valuesYaml,
    },
    timeoutMs: 180000,
  });

export const rollbackHelmRelease = (name: string, namespace: string, revision: number) =>
  request<{ message: string }>(`/api/helm/releases/${name}/rollback`, {
    method: "POST",
    body: { namespace, revision },
    timeoutMs: 60000,
  });

export const fetchContexts = () =>
  request<string[]>("/api/cluster/contexts").then(r => r ?? []);

export const connectToContext = (context: string) =>
  request<{ status: string; context: string; version: string }>("/api/cluster/connect", {
    method: "POST",
    body: { context },
  });

export interface PodMetrics {
  name: string;
  namespace: string;
  cpu: string;
  memory: string;
  containers: { name: string; cpu: string; memory: string }[];
}

export const fetchPodMetrics = (pod: string, namespace: string) =>
  request<PodMetrics>(
    `/api/metrics/pod/${pod}?namespace=${encodeURIComponent(namespace)}`
  );

/** Averages across a workload's pods. CPU is millicores, memory is MiB. */
export const fetchResourceMetrics = (namespace: string, kind: string, name: string) =>
  request<{ cpu: number; memory: number; pods: number }>(
    `/api/metrics/${namespace}/${kind}/${name}`
  );

/** Compiles the whole graph server-side so edges resolve into real references. */
/** `stack` (the workflow's name) labels everything compiled, so it can be found again. */
export const compileGraph = (nodes: unknown[], edges: unknown[], stack?: string) =>
  request<CompileResult>("/api/graph/compile", {
    method: "POST",
    body: { nodes, edges, stack },
    timeoutMs: 30000,
  });

export interface ImportedGraph {
  nodes: { id: string; kind: string; name: string; namespace: string; fields: Record<string, unknown> }[];
  edges: { source: string; target: string }[];
  notes: CompileNote[];
}

/** Parses manifests server-side, where there is a real YAML decoder. */
export const importManifest = (yaml: string) =>
  request<ImportedGraph>("/api/graph/import", { method: "POST", body: { yaml } });

export const applyYaml = (yaml: string, dryRun: boolean) =>
  request<{ success: boolean }>(`/api/graph/apply${dryRun ? "?dryRun=true" : ""}`, {
    method: "POST",
    body: { yaml },
    timeoutMs: 60000,
  });

/** force drops the grace period, for objects stuck terminating. */
/** Clears the finalizers on something already being deleted. */
export const finishDeletion = (kind: string, name: string, namespace: string) =>
  request<{ message: string }>("/api/resource/finalize", {
    method: "POST",
    body: { kind, name, namespace },
  });

export const deleteResource = (
  kind: string,
  name: string,
  namespace: string,
  force = false
) =>
  request<{ message: string; terminating?: boolean; hint?: string }>(
    `/api/resource/delete${force ? "?force=true" : ""}`,
    {
      method: "DELETE",
      body: { kind, name, namespace },
    }
  );

// --- Day-to-day operations ------------------------------------------------------

export interface Forward {
  id: string;
  namespace: string;
  kind: string;
  name: string;
  pod: string;
  remotePort: number;
  localPort: number;
  url: string;
}

export const fetchForwards = () =>
  request<{ forwards: Forward[] }>("/api/portforward").then(r => r?.forwards ?? []);

/** Opens a tunnel from localhost to a Service or Pod. */
export const startForward = (kind: string, namespace: string, name: string, port?: number) =>
  request<Forward>("/api/portforward", { method: "POST", body: { kind, namespace, name, port } });

export const stopForward = (id: string) =>
  request<{ message: string }>(`/api/portforward/${encodeURIComponent(id)}`, { method: "DELETE" });

export const revealSecret = (namespace: string, name: string) =>
  request<{ data: Record<string, string> }>(
    `/api/secret/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`
  ).then(r => r?.data ?? {});

export const workloadAction = (
  action: "scale" | "restart" | "rollback",
  kind: string,
  namespace: string,
  name: string,
  replicas?: number
) =>
  request<{ message: string }>(`/api/workload/${action}`, {
    method: "POST",
    body: { kind, namespace, name, replicas },
  });

export const execInPod = (namespace: string, pod: string, command: string, container?: string) =>
  request<{ output: string; exitError?: string }>("/api/exec", {
    method: "POST",
    body: { namespace, pod, container, command },
    timeoutMs: 40000,
  });

export const createNamespace = (name: string) =>
  request<{ message: string }>("/api/cluster/namespaces", { method: "POST", body: { name } });

export const deleteNamespace = (name: string) =>
  request<{ message: string }>(`/api/cluster/namespaces/${encodeURIComponent(name)}`, { method: "DELETE" });

export interface Permission {
  source: string;
  verbs: string[];
  resources: string[];
  apiGroups?: string[];
  namespace: string;
}

export const fetchPermissions = (namespace: string, name: string) =>
  request<{ permissions: Permission[] }>(
    `/api/rbac/serviceaccount/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`
  ).then(r => r?.permissions ?? []);

export const fetchIngressClasses = () =>
  request<{ ingressClasses: string[] }>("/api/cluster/ingressclasses").then(r => r?.ingressClasses ?? []);

export const checkMetricsServer = () =>
  request<{ available: boolean }>("/api/metrics/check").then(r => Boolean(r?.available));

export interface Change {
  resource: string;
  action: "create" | "update" | "unchanged" | "error";
  diff?: string;
  error?: string;
}

/** What applying would change, object by object, against the live cluster. */
export const diffYaml = (yaml: string) =>
  request<{ changes: Change[] }>("/api/graph/diff", { method: "POST", body: { yaml }, timeoutMs: 45000 }).then(
    r => r?.changes ?? []
  );
