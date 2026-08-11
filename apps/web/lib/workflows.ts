import { Edge, Node } from "reactflow";
import { ApiError, request } from "./api";

// Workflows live in Postgres when it is available and in the browser otherwise.
// The UI used to show these as two separate lists ("Saved Workflows (Local)" and
// "Saved Graphs (Database)") with different code paths behind each; here there is
// one list and each entry says where it came from.

const LOCAL_KEY = "k8n_workflows";

export type WorkflowSource = "database" | "browser";

export interface WorkflowSummary {
  id: string;
  name: string;
  namespace: string;
  updatedAt: string;
  source: WorkflowSource;
}

export interface WorkflowGraph {
  name: string;
  namespace: string;
  nodes: Node[];
  edges: Edge[];
}

interface StoredWorkflow extends WorkflowGraph {
  id: string;
  updatedAt: string;
}

function readLocal(): StoredWorkflow[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

const writeLocal = (items: StoredWorkflow[]) =>
  localStorage.setItem(LOCAL_KEY, JSON.stringify(items));

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  let remote: WorkflowSummary[] = [];
  try {
    const rows = await request<
      { id: string; name: string; namespace: string; created_at: string }[]
    >("/api/graph/list");
    remote = (rows ?? []).map(row => ({
      id: row.id,
      name: row.name,
      namespace: row.namespace,
      updatedAt: row.created_at,
      source: "database" as const,
    }));
  } catch {
    // No database configured — browser storage is the whole story.
  }

  const local: WorkflowSummary[] = readLocal().map(w => ({
    id: w.id,
    name: w.name,
    namespace: w.namespace,
    updatedAt: w.updatedAt,
    source: "browser" as const,
  }));

  return [...remote, ...local].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Saves to the database, falling back to the browser when there is none. */
export async function saveWorkflow(
  graph: WorkflowGraph,
  id?: string | null
): Promise<{ id: string; source: WorkflowSource }> {
  try {
    const saved = await request<{ id: string }>("/api/graph/save", {
      method: "POST",
      body: {
        id,
        name: graph.name,
        namespace: graph.namespace,
        graph_json: { nodes: graph.nodes, edges: graph.edges },
      },
    });
    return { id: saved.id, source: "database" };
  } catch (err) {
    // 503 means "no database"; anything else is a real failure worth surfacing.
    if (!(err instanceof ApiError) || err.status !== 503) throw err;
  }

  const items = readLocal();
  const localId = id && items.some(w => w.id === id) ? id : `local-${Date.now()}`;
  const entry: StoredWorkflow = { ...graph, id: localId, updatedAt: new Date().toISOString() };
  writeLocal([...items.filter(w => w.id !== localId), entry]);
  return { id: localId, source: "browser" };
}

export async function loadWorkflow(
  id: string,
  source: WorkflowSource
): Promise<WorkflowGraph> {
  if (source === "browser") {
    const found = readLocal().find(w => w.id === id);
    if (!found) throw new Error("That workflow is no longer in browser storage");
    return found;
  }

  const row = await request<{
    name: string;
    namespace: string;
    graph_json: { nodes: Node[]; edges: Edge[] };
  }>(`/api/graph/${id}`);

  return {
    name: row.name,
    namespace: row.namespace,
    nodes: row.graph_json?.nodes ?? [],
    edges: row.graph_json?.edges ?? [],
  };
}

export async function deleteWorkflow(
  id: string,
  source: WorkflowSource
): Promise<void> {
  if (source === "browser") {
    writeLocal(readLocal().filter(w => w.id !== id));
    return;
  }
  await request(`/api/graph/${id}`, { method: "DELETE" });
}
