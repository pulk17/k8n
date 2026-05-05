export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export interface K8sResource {
  kind: string;
  name: string;
  namespace: string;
  labels: Record<string, string>;
  status: string;
  uid: string;
  selector?: Record<string, string>;
  ownerReferences?: string[];
}

// Only true network errors (TypeError: Failed to fetch) indicate the API is unreachable
function isNetworkError(error: any): boolean {
  return error instanceof TypeError && (
    error.message === 'Failed to fetch' ||
    error.message.includes('NetworkError') ||
    error.message.includes('network')
  );
}

export async function fetchResources(): Promise<K8sResource[]> {
  try {
    const res = await fetch(`${API_URL}/api/cluster/resources`);
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Failed to fetch resources: ${res.status} ${res.statusText}. ${errorText}`);
    }
    return res.json();
  } catch (error: any) {
    if (isNetworkError(error)) {
      throw new Error(`Cannot connect to API server at ${API_URL}. Please ensure the backend is running.`);
    }
    throw error;
  }
}

export async function fetchCRDs() {
  try {
    const res = await fetch(`${API_URL}/api/cluster/crds`);
    if (!res.ok) {
      throw new Error(`Failed to fetch CRDs: ${res.status} ${res.statusText}`);
    }
    return res.json();
  } catch (error: any) {
    if (isNetworkError(error)) {
      throw new Error(`Cannot connect to API server at ${API_URL}`);
    }
    throw error;
  }
}

export async function fetchHelmCharts(query: string = "nginx") {
  try {
    const res = await fetch(`${API_URL}/api/helm/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Failed to fetch Helm Charts: ${res.status} ${res.statusText}. ${errorText}`);
    }
    return res.json();
  } catch (error: any) {
    if (isNetworkError(error)) {
      throw new Error(`Cannot connect to API server at ${API_URL}`);
    }
    throw error;
  }
}

export async function fetchContexts(): Promise<string[]> {
  try {
    const res = await fetch(`${API_URL}/api/cluster/contexts`);
    if (!res.ok) {
      throw new Error(`Failed to fetch contexts: ${res.status} ${res.statusText}`);
    }
    return res.json();
  } catch (error: any) {
    if (isNetworkError(error)) {
      throw new Error(`Cannot connect to API server at ${API_URL}`);
    }
    throw error;
  }
}

export async function connectToContext(context: string): Promise<any> {
  try {
    const res = await fetch(`${API_URL}/api/cluster/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context }),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.details || errorData.error || `Connection failed: ${res.status}`);
    }
    return res.json();
  } catch (error: any) {
    if (isNetworkError(error)) {
      throw new Error(`Cannot connect to API server at ${API_URL}`);
    }
    throw error;
  }
}
