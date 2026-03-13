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

export async function fetchResources(): Promise<K8sResource[]> {
  const res = await fetch(`${API_URL}/api/cluster/resources`);
  if (!res.ok) throw new Error("Failed to fetch resources");
  return res.json();
}

export async function fetchCRDs() {
  const res = await fetch(`${API_URL}/api/cluster/crds`);
  if (!res.ok) {
    throw new Error("Failed to fetch CRDs");
  }
  return res.json();
}

export async function fetchHelmCharts(query: string = "nginx") {
  const res = await fetch(`${API_URL}/api/helm/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    throw new Error("Failed to fetch Helm Charts");
  }
  return res.json();
}

export async function fetchContexts(): Promise<string[]> {
  const res = await fetch(`${API_URL}/api/cluster/contexts`);
  if (!res.ok) throw new Error("Failed to fetch contexts");
  return res.json();
}

export async function connectToContext(context: string): Promise<any> {
  const res = await fetch(`${API_URL}/api/cluster/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context }),
  });
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.error || "Connection failed");
  }
  return res.json();
}
