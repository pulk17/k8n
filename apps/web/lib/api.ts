// API_URL is empty by default so the browser talks to the Next.js origin and
// next.config.ts proxies /api/* to the Go backend. Same-origin means no CORS in
// the normal path; set NEXT_PUBLIC_API_URL only when pointing at a backend on a
// different host.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export interface ContainerSummary {
  name: string;
  image: string;
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

/** The message to show a user for anything thrown. */
export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

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
  details?: string;

  constructor(message: string, status: number, details?: string) {
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
    const res = await fetch(`${API_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      let details: string | undefined;
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
  const source = new EventSource(`${API_URL}/api/cluster/watch${query}`);
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
}

export const searchHelmCharts = (query: string) =>
  request<HelmChart[]>(`/api/helm/search?q=${encodeURIComponent(query)}`).then(r => r ?? []);

export const installHelmChart = (params: ChartRequest) =>
  request<HelmRelease>("/api/helm/install", { method: "POST", body: params, timeoutMs: 180000 });

/** Renders a chart to YAML without installing it, for the manifest preview. */
export const templateHelmChart = (params: ChartRequest) =>
  request<{ yaml: string }>("/api/helm/template", {
    method: "POST",
    body: params,
    timeoutMs: 120000,
  });

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
export const compileGraph = (nodes: unknown[], edges: unknown[]) =>
  request<CompileResult>("/api/graph/compile", {
    method: "POST",
    body: { nodes, edges },
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
export const deleteResource = (
  kind: string,
  name: string,
  namespace: string,
  force = false
) =>
  request<{ message: string }>(`/api/resource/delete${force ? "?force=true" : ""}`, {
    method: "DELETE",
    body: { kind, name, namespace },
  });
