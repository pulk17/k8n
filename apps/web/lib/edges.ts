import { Edge } from "reactflow";
import { K8sResource } from "./api";
import { getConnectionType, isAnimatedType, ConnectionType } from "./connections";

// Re-exported so existing imports keep working; the definitions now live in
// connections.ts, which is the single source of truth for the graph's rules.
export { isValidConnection, getConnectionType, validTargetsFor } from "./connections";
export { CONNECTION_TYPES as connectionTypes } from "./constants";

/** Label-selector match: every selector key must equal the label's value. */
function selectorMatches(
  selector: Record<string, string> | undefined,
  labels: Record<string, string> | undefined
): boolean {
  if (!selector || Object.keys(selector).length === 0) return false;
  if (!labels) return false;
  return Object.entries(selector).every(([k, v]) => labels[k] === v);
}

interface EdgeOptions {
  dashed?: boolean;
  thin?: boolean;
}

function makeEdge(
  source: K8sResource,
  target: K8sResource,
  opts: EdgeOptions = {}
): Edge {
  const { type, color } = getConnectionType(source.kind, target.kind);
  const style: Record<string, string | number> = {
    stroke: color,
    strokeWidth: opts.thin ? 1 : 2,
  };
  if (opts.dashed) style.strokeDasharray = "5,5";
  if (opts.thin) style.opacity = 0.5;

  return {
    id: `edge-${source.uid}-${target.uid}-${type}`,
    source: source.uid,
    target: target.uid,
    type: "default",
    animated: isAnimatedType(type as ConnectionType),
    style,
    data: { edgeType: type },
  };
}

/**
 * Derives edges from what the cluster actually reports.
 *
 * Previously most of this was a namespace cross-product — every Ingress was
 * joined to every Service, every PVC and HPA to every workload, and ConfigMaps
 * were matched by fuzzy string comparison on names. Now each relationship comes
 * from a real reference on the live object (ingress backends, scaleTargetRef,
 * volume claims, envFrom/volume references), so the graph reflects the cluster
 * rather than approximating it.
 */
export function generateEdges(resources: K8sResource[]): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  const push = (edge: Edge) => {
    if (seen.has(edge.id)) return;
    seen.add(edge.id);
    edges.push(edge);
  };

  const byKind = (kind: string) => resources.filter(r => r.kind === kind);

  const services = byKind("Service");
  const ingresses = byKind("Ingress");
  const deployments = byKind("Deployment");
  const statefulSets = byKind("StatefulSet");
  const daemonSets = byKind("DaemonSet");
  const replicaSets = byKind("ReplicaSet");
  const pods = byKind("Pod");
  const configMaps = byKind("ConfigMap");
  const secrets = byKind("Secret");
  const pvcs = byKind("PersistentVolumeClaim");
  const hpas = byKind("HorizontalPodAutoscaler");
  const serviceAccounts = byKind("ServiceAccount");

  const podded = [...deployments, ...statefulSets, ...daemonSets, ...replicaSets, ...pods];

  // Index by namespace+name so reference lookups are direct.
  const index = new Map<string, K8sResource>();
  for (const r of resources) {
    index.set(`${r.kind}/${r.namespace}/${r.name}`, r);
  }
  const lookup = (kind: string, namespace: string, name: string) =>
    index.get(`${kind}/${namespace}/${name}`);

  // 1. Service → workload, by label selector.
  for (const svc of services) {
    for (const workload of podded) {
      if (svc.namespace !== workload.namespace) continue;
      if (selectorMatches(svc.selector, workload.labels)) {
        push(makeEdge(svc, workload));
      }
    }
  }

  // 2. Ingress → Service, from the ingress's actual backends.
  for (const ing of ingresses) {
    for (const backend of ing.backends || []) {
      const svc = lookup("Service", ing.namespace, backend);
      if (svc) push(makeEdge(ing, svc));
    }
  }

  // 3. ConfigMap/Secret → workload, from envFrom / env / volume references.
  for (const workload of podded) {
    for (const name of workload.configMapRefs || []) {
      const cm = lookup("ConfigMap", workload.namespace, name);
      if (cm) push(makeEdge(cm, workload, { dashed: true }));
    }
    for (const name of workload.secretRefs || []) {
      const secret = lookup("Secret", workload.namespace, name);
      if (secret) push(makeEdge(secret, workload, { dashed: true }));
    }
  }

  // 4. PVC → workload, from the volumes the workload actually claims.
  for (const workload of podded) {
    for (const name of workload.pvcRefs || []) {
      const pvc = lookup("PersistentVolumeClaim", workload.namespace, name);
      if (pvc) push(makeEdge(pvc, workload, { dashed: true }));
    }
  }

  // 5. HPA → workload, from scaleTargetRef.
  for (const hpa of hpas) {
    if (!hpa.scaleTargetKind || !hpa.scaleTargetName) continue;
    const target = lookup(hpa.scaleTargetKind, hpa.namespace, hpa.scaleTargetName);
    if (target) push(makeEdge(hpa, target, { dashed: true }));
  }

  // 6. ServiceAccount → workload, from serviceAccountName.
  for (const workload of podded) {
    const sa = workload.serviceAccountName;
    // "default" is on nearly every pod and would bury the graph in edges.
    if (!sa || sa === "default") continue;
    const account = lookup("ServiceAccount", workload.namespace, sa);
    if (account) push(makeEdge(account, workload, { dashed: true }));
  }

  // 7. Ownership: Deployment → ReplicaSet → Pod.
  for (const dep of deployments) {
    const owned = replicaSets.filter(
      rs => rs.namespace === dep.namespace && rs.ownerReferences?.includes(dep.name)
    );
    for (const rs of owned) {
      push(makeEdge(dep, rs, { thin: true }));
      const ownedPods = pods.filter(
        p => p.namespace === rs.namespace && p.ownerReferences?.includes(rs.name)
      );
      for (const pod of ownedPods) {
        push(makeEdge(rs, pod, { thin: true }));
      }
    }
  }

  // 8. Ownership for controllers that own pods directly.
  for (const controller of [...statefulSets, ...daemonSets]) {
    const ownedPods = pods.filter(
      p => p.namespace === controller.namespace && p.ownerReferences?.includes(controller.name)
    );
    for (const pod of ownedPods) {
      push(makeEdge(controller, pod, { thin: true }));
    }
  }

  // 9. Unresolved config: ConfigMaps and Secrets nothing references are still
  //    worth showing, but they get no invented edges.
  void configMaps;
  void secrets;
  void pvcs;
  void serviceAccounts;

  return edges;
}
