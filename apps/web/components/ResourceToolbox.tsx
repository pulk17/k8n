import { DragEvent, useEffect, useState } from "react";
import { CopyPlus, Layers } from "lucide-react";
import { fetchCRDs } from "../lib/api";

export default function ResourceToolbox() {
  const [crds, setCrds] = useState<{ kind: string; name: string; group: string }[]>([]);

  useEffect(() => {
    fetchCRDs().then(setCrds).catch(() => {
      // Silently ignore — API may not be running yet, CRDs are optional
    });
  }, []);
  const onDragStart = (event: DragEvent<HTMLDivElement>, nodeType: string, kind: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.setData("application/k8sKind", kind);
    event.dataTransfer.effectAllowed = "move";
  };

  const resourceTypes = [
    // Workloads
    { kind: "Deployment", color: "bg-blue-500", border: "border-blue-500", category: "Workloads" },
    { kind: "StatefulSet", color: "bg-cyan-500", border: "border-cyan-500", category: "Workloads" },
    { kind: "DaemonSet", color: "bg-orange-500", border: "border-orange-500", category: "Workloads" },
    { kind: "Job", color: "bg-teal-500", border: "border-teal-500", category: "Workloads" },
    { kind: "CronJob", color: "bg-teal-600", border: "border-teal-600", category: "Workloads" },
    { kind: "Pod", color: "bg-gray-500", border: "border-gray-500", category: "Workloads" },
    
    // Network
    { kind: "Service", color: "bg-green-500", border: "border-green-500", category: "Network" },
    { kind: "Ingress", color: "bg-pink-500", border: "border-pink-500", category: "Network" },
    { kind: "NetworkPolicy", color: "bg-red-500", border: "border-red-500", category: "Network" },
    
    // Config & Storage
    { kind: "ConfigMap", color: "bg-yellow-500", border: "border-yellow-500", category: "Config" },
    { kind: "Secret", color: "bg-red-600", border: "border-red-600", category: "Config" },
    { kind: "PersistentVolumeClaim", color: "bg-purple-500", border: "border-purple-500", category: "Storage" },
    { kind: "PersistentVolume", color: "bg-purple-600", border: "border-purple-600", category: "Storage" },
    
    // Security & RBAC
    { kind: "ServiceAccount", color: "bg-indigo-500", border: "border-indigo-500", category: "Security" },
    { kind: "Role", color: "bg-indigo-600", border: "border-indigo-600", category: "Security" },
    { kind: "RoleBinding", color: "bg-indigo-700", border: "border-indigo-700", category: "Security" },
    { kind: "ClusterRole", color: "bg-violet-600", border: "border-violet-600", category: "Security" },
    { kind: "ClusterRoleBinding", color: "bg-violet-700", border: "border-violet-700", category: "Security" },
    
    // Autoscaling
    { kind: "HorizontalPodAutoscaler", color: "bg-sky-500", border: "border-sky-500", category: "Autoscaling" },
  ];

  // Group resources by category
  const groupedResources = resourceTypes.reduce((acc, res) => {
    if (!acc[res.category]) acc[res.category] = [];
    acc[res.category].push(res);
    return acc;
  }, {} as Record<string, typeof resourceTypes>);

  return (
    <div className="absolute top-16 left-4 z-10 w-64 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-md border border-gray-200 dark:border-neutral-800 rounded-2xl shadow-sm flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-neutral-800 bg-gray-50/50 dark:bg-neutral-900/50 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Resources</h2>
        <CopyPlus className="w-4 h-4 text-gray-400" />
      </div>
      
      <div className="p-3 space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto custom-scrollbar">
        {Object.entries(groupedResources).map(([category, resources]) => (
          <div key={category}>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 px-2 uppercase tracking-wide">
              {category}
            </h3>
            <div className="space-y-1">
              {resources.map((res) => (
                <div
                  key={res.kind}
                  className={`flex items-center space-x-3 p-2 rounded-md cursor-grab active:cursor-grabbing border ${res.border} bg-white dark:bg-neutral-900 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors shadow-sm`}
                  onDragStart={(event) => onDragStart(event, "k8sNode", res.kind)}
                  draggable
                >
                  <div className={`w-3 h-3 rounded-full ${res.color}`} />
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    {res.kind}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        
        {crds.length > 0 && (
          <div className="pt-2 mt-2 border-t border-gray-100 dark:border-neutral-800">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 px-2 uppercase tracking-wide">Custom Resources</h3>
            {crds.map((crd) => (
              <div
                key={crd.name}
                className="flex items-center space-x-3 p-2 mt-1 rounded-md cursor-grab active:cursor-grabbing border border-purple-500/30 bg-white dark:bg-neutral-900 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors shadow-sm"
                onDragStart={(event) => onDragStart(event, "k8sNode", crd.kind)}
                draggable
              >
                <Layers className="w-4 h-4 text-purple-500" />
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 leading-tight">
                    {crd.kind}
                  </span>
                  <span className="text-[10px] text-gray-400 mt-0.5 max-w-[150px] truncate" title={crd.group}>
                    {crd.group}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="px-4 py-3 border-t border-gray-100 dark:border-neutral-800 text-xs text-gray-500 text-center">
        Drag to canvas to create
      </div>
    </div>
  );
}
