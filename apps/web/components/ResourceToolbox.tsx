"use client";

import { DragEvent, useEffect, useState } from "react";
import { CopyPlus, Layers } from "lucide-react";
import { fetchCRDs } from "../lib/api";
import { DEFAULT_RESOURCE_COLOR, RESOURCE_COLORS } from "../lib/constants";
import ConnectionLegend from "./ConnectionLegend";

// Kinds you can drag onto the canvas, in the order they are worth reaching for.
// Colour is not repeated here: it comes from RESOURCE_COLORS, so the swatch in
// this list is always the colour the node will actually be. This list used to
// carry its own Tailwind classes and had drifted out of step with the nodes.
const CATEGORIES: { name: string; kinds: string[] }[] = [
  {
    name: "Workloads",
    kinds: ["Deployment", "StatefulSet", "DaemonSet", "Pod", "Job", "CronJob"],
  },
  {
    name: "Networking",
    kinds: ["Service", "Ingress", "NetworkPolicy"],
  },
  {
    name: "Configuration",
    kinds: ["ConfigMap", "Secret"],
  },
  {
    name: "Storage",
    kinds: ["PersistentVolumeClaim", "PersistentVolume"],
  },
  {
    name: "Access control",
    kinds: ["ServiceAccount", "Role", "RoleBinding", "ClusterRole", "ClusterRoleBinding"],
  },
  {
    name: "Scaling",
    kinds: ["HorizontalPodAutoscaler"],
  },
];

export default function ResourceToolbox() {
  const [crds, setCrds] = useState<{ kind: string; name: string; group: string }[]>([]);

  useEffect(() => {
    // CRDs are a bonus; without a cluster the built-in kinds still work.
    fetchCRDs().then(setCrds).catch(() => {});
  }, []);

  const onDragStart = (event: DragEvent<HTMLDivElement>, kind: string) => {
    event.dataTransfer.setData("application/reactflow", "k8sNode");
    event.dataTransfer.setData("application/k8sKind", kind);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="absolute left-4 top-16 z-10 flex w-64 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/95 shadow-sm backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-300">Resources</h2>
        <CopyPlus className="h-4 w-4 text-gray-500" />
      </div>

      <div className="custom-scrollbar max-h-[calc(100vh-320px)] space-y-3 overflow-y-auto p-3">
        {CATEGORIES.map(({ name, kinds }) => (
          <div key={name}>
            <h3 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              {name}
            </h3>
            <div className="space-y-1">
              {kinds.map(kind => {
                const color = RESOURCE_COLORS[kind] || DEFAULT_RESOURCE_COLOR;
                return (
                  <div
                    key={kind}
                    draggable
                    onDragStart={event => onDragStart(event, kind)}
                    className="flex cursor-grab items-center gap-2.5 rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 transition-colors hover:border-neutral-600 hover:bg-neutral-800 active:cursor-grabbing"
                  >
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
                    <span className="text-xs font-medium text-gray-300">{kind}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {crds.length > 0 && (
          <div className="border-t border-neutral-800 pt-3">
            <h3 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Custom resources
            </h3>
            {crds.map(crd => (
              <div
                key={crd.name}
                draggable
                onDragStart={event => onDragStart(event, crd.kind)}
                className="mt-1 flex cursor-grab items-center gap-2.5 rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 transition-colors hover:border-neutral-600 hover:bg-neutral-800 active:cursor-grabbing"
              >
                <Layers className="h-3.5 w-3.5" style={{ color: DEFAULT_RESOURCE_COLOR }} />
                <div className="flex min-w-0 flex-col">
                  <span className="text-xs font-medium leading-tight text-gray-300">{crd.kind}</span>
                  <span className="truncate text-[10px] text-gray-500" title={crd.group}>
                    {crd.group}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-neutral-800 px-3 py-2.5">
        <p className="text-[10px] text-gray-500">Drag onto the canvas to add.</p>
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Connections
          </p>
          <ConnectionLegend />
        </div>
      </div>
    </div>
  );
}
