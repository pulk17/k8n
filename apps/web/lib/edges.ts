import { Edge } from "reactflow";
import { K8sResource } from "./api";

function isMatch(selector: Record<string, string>, labels: Record<string, string>) {
  if (!selector || Object.keys(selector).length === 0) return false;
  if (!labels) return false;
  for (const [k, v] of Object.entries(selector)) {
    if (labels[k] !== v) return false;
  }
  return true;
}

export function generateEdges(resources: K8sResource[]): Edge[] {
  const edges: Edge[] = [];
  
  const services = resources.filter(r => r.kind === "Service");
  const deployments = resources.filter(r => r.kind === "Deployment");
  const replicaSets = resources.filter(r => r.kind === "ReplicaSet");
  const pods = resources.filter(r => r.kind === "Pod");

  // 1. Service -> Deployment
  services.forEach(svc => {
    deployments.forEach(dep => {
      // Service namespace must match Deployment namespace
      if (svc.namespace === dep.namespace && isMatch(svc.selector || {}, dep.labels)) {
        edges.push({
          id: `edge-${svc.uid}-${dep.uid}`,
          source: svc.uid,
          target: dep.uid,
          type: "default",
          animated: true,
          data: { edgeType: "dependency" }
        });
      }
    });
  });

  // 2. Deployment -> ReplicaSet -> Pod edge linking
  deployments.forEach(dep => {
     const ownedRs = replicaSets.filter(rs => rs.ownerReferences?.includes(dep.name) && rs.namespace === dep.namespace);
     ownedRs.forEach(rs => {
         const ownedPods = pods.filter(pod => pod.ownerReferences?.includes(rs.name) && pod.namespace === rs.namespace);
         ownedPods.forEach(pod => {
             // Create direct UI edge from Deployment to Pod for visual clarity
             edges.push({
               id: `edge-${dep.uid}-${pod.uid}`,
               source: dep.uid,
               target: pod.uid,
               type: "default",
               animated: false,
               data: { edgeType: "dependency" }
             });
         });
     });
  });

  return edges;
}
