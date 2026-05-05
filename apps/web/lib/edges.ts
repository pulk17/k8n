import { Edge } from "reactflow";
import { K8sResource } from "./api";
import { CONNECTION_TYPES, VALID_CONNECTIONS } from "./constants";

function isMatch(selector: Record<string, string>, labels: Record<string, string>) {
  if (!selector || Object.keys(selector).length === 0) return false;
  if (!labels) return false;
  for (const [k, v] of Object.entries(selector)) {
    if (labels[k] !== v) return false;
  }
  return true;
}

// Connection type definitions with colors (re-exported from constants for convenience)
export const connectionTypes = CONNECTION_TYPES;

// Validate if a connection is allowed between two resource types
export function isValidConnection(sourceKind: string, targetKind: string): boolean {
  return VALID_CONNECTIONS[sourceKind]?.includes(targetKind) || false;
}

// Get connection type and color based on source and target kinds
export function getConnectionType(sourceKind: string, targetKind: string): { type: string; color: string } {
  if (sourceKind === 'Service') return { type: 'network', color: connectionTypes.network.color };
  if (sourceKind === 'Ingress') return { type: 'routing', color: connectionTypes.routing.color };
  if (sourceKind === 'ConfigMap' || sourceKind === 'Secret') return { type: 'config', color: connectionTypes.config.color };
  if (sourceKind === 'PersistentVolumeClaim' || sourceKind === 'PersistentVolume') return { type: 'storage', color: connectionTypes.storage.color };
  if (sourceKind === 'HorizontalPodAutoscaler' || sourceKind === 'VerticalPodAutoscaler') return { type: 'scaling', color: connectionTypes.scaling.color };
  if (sourceKind === 'NetworkPolicy' || sourceKind === 'ServiceAccount' || sourceKind === 'Role' || sourceKind === 'ClusterRole') {
    return { type: 'security', color: connectionTypes.security.color };
  }
  return { type: 'ownership', color: connectionTypes.ownership.color };
}

export function generateEdges(resources: K8sResource[]): Edge[] {
  const edges: Edge[] = [];
  
  const services = resources.filter(r => r.kind === "Service");
  const ingresses = resources.filter(r => r.kind === "Ingress");
  const deployments = resources.filter(r => r.kind === "Deployment");
  const statefulSets = resources.filter(r => r.kind === "StatefulSet");
  const replicaSets = resources.filter(r => r.kind === "ReplicaSet");
  const pods = resources.filter(r => r.kind === "Pod");
  const configMaps = resources.filter(r => r.kind === "ConfigMap");
  const secrets = resources.filter(r => r.kind === "Secret");
  const pvcs = resources.filter(r => r.kind === "PersistentVolumeClaim");
  const hpas = resources.filter(r => r.kind === "HorizontalPodAutoscaler");

  // 1. Service -> Deployment/StatefulSet/Pod
  services.forEach(svc => {
    [...deployments, ...statefulSets].forEach(workload => {
      if (svc.namespace === workload.namespace && isMatch(svc.selector || {}, workload.labels)) {
        const connType = getConnectionType('Service', workload.kind);
        edges.push({
          id: `edge-${svc.uid}-${workload.uid}`,
          source: svc.uid,
          target: workload.uid,
          type: "default",
          animated: true,
          style: { stroke: connType.color, strokeWidth: 2 },
          data: { edgeType: connType.type }
        });
      }
    });
  });

  // 2. Ingress -> Service
  ingresses.forEach(ing => {
    services.forEach(svc => {
      if (ing.namespace === svc.namespace) {
        const connType = getConnectionType('Ingress', 'Service');
        edges.push({
          id: `edge-${ing.uid}-${svc.uid}`,
          source: ing.uid,
          target: svc.uid,
          type: "default",
          animated: true,
          style: { stroke: connType.color, strokeWidth: 2 },
          data: { edgeType: connType.type }
        });
      }
    });
  });

  // 3. ConfigMap/Secret -> Workloads (only connect when names suggest a relationship)
  // Avoids O(n²) by requiring name-based matching instead of connecting everything
  [...configMaps, ...secrets].forEach(config => {
    [...deployments, ...statefulSets].forEach(workload => {
      if (config.namespace !== workload.namespace) return;
      
      // Only connect if the config name contains the workload name or vice versa
      const configBase = config.name.replace(/-config$|-secret$|-cm$|-configmap$/, '');
      const workloadBase = workload.name.replace(/-deployment$|-sts$/, '');
      const isRelated = config.name.includes(workloadBase) || 
                        workload.name.includes(configBase) ||
                        configBase === workloadBase;
      
      if (isRelated) {
        const connType = getConnectionType(config.kind, workload.kind);
        edges.push({
          id: `edge-${config.uid}-${workload.uid}`,
          source: config.uid,
          target: workload.uid,
          type: "default",
          animated: false,
          style: { stroke: connType.color, strokeWidth: 2, strokeDasharray: '5,5' },
          data: { edgeType: connType.type }
        });
      }
    });
  });

  // 4. PVC -> Workloads
  pvcs.forEach(pvc => {
    [...deployments, ...statefulSets, ...pods].forEach(workload => {
      if (pvc.namespace === workload.namespace) {
        const connType = getConnectionType('PersistentVolumeClaim', workload.kind);
        edges.push({
          id: `edge-${pvc.uid}-${workload.uid}`,
          source: pvc.uid,
          target: workload.uid,
          type: "default",
          animated: false,
          style: { stroke: connType.color, strokeWidth: 2, strokeDasharray: '5,5' },
          data: { edgeType: connType.type }
        });
      }
    });
  });

  // 5. HPA -> Deployment/StatefulSet
  hpas.forEach(hpa => {
    [...deployments, ...statefulSets, ...replicaSets].forEach(workload => {
      if (hpa.namespace === workload.namespace) {
        const connType = getConnectionType('HorizontalPodAutoscaler', workload.kind);
        edges.push({
          id: `edge-${hpa.uid}-${workload.uid}`,
          source: hpa.uid,
          target: workload.uid,
          type: "default",
          animated: false,
          style: { stroke: connType.color, strokeWidth: 2, strokeDasharray: '3,3' },
          data: { edgeType: connType.type }
        });
      }
    });
  });

  // 6. Deployment -> ReplicaSet -> Pod (ownership chain)
  deployments.forEach(dep => {
     const ownedRs = replicaSets.filter(rs => rs.ownerReferences?.includes(dep.name) && rs.namespace === dep.namespace);
     ownedRs.forEach(rs => {
         const ownedPods = pods.filter(pod => pod.ownerReferences?.includes(rs.name) && pod.namespace === rs.namespace);
         ownedPods.forEach(pod => {
             edges.push({
               id: `edge-${dep.uid}-${pod.uid}`,
               source: dep.uid,
               target: pod.uid,
               type: "default",
               animated: false,
               style: { stroke: connectionTypes.ownership.color, strokeWidth: 1, opacity: 0.5 },
               data: { edgeType: 'ownership' }
             });
         });
     });
  });

  return edges;
}
