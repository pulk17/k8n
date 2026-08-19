"use client";

import { memo, useState } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import {
  Box, Database, Globe, FileCode, Lock, Layers, Briefcase, Clock, Network,
  CloudDownload, AlertTriangle, LucideIcon,
} from "lucide-react";
import { useCanvasStore } from "../store/canvasStore";
import { inputsFor, outputsFor, HandleSpec } from "../lib/connections";
import { FieldValue, NodeData, fieldValue } from "../lib/graph";
import { darkStatusStyle } from "../lib/constants";

/**
 * A resource on the canvas.
 *
 * The card used to open into a full edit form in place, which pushed every
 * other node around the moment you clicked one, and made a graph of six
 * resources unreadable as soon as two of them were open. Editing moved to the
 * inspector on the right; what is left here is what you want to read at a
 * glance while looking at the shape of the graph — name, kind, where it lives,
 * whether it is healthy, and the one detail that identifies it.
 */

const iconMap: Record<string, LucideIcon> = {
  Deployment: Box,
  Service: Globe,
  Pod: Box,
  ConfigMap: FileCode,
  Secret: Lock,
  ReplicaSet: Layers,
  StatefulSet: Database,
  DaemonSet: Briefcase,
  Job: Clock,
  CronJob: Clock,
  Ingress: Network,
  HelmRelease: Layers,
  PersistentVolumeClaim: Database,
  PersistentVolume: Database,
  Namespace: Layers,
  ServiceAccount: Lock,
  Role: Lock,
  RoleBinding: Lock,
  ClusterRole: Lock,
  ClusterRoleBinding: Lock,
  NetworkPolicy: Network,
  HorizontalPodAutoscaler: Layers,
  VerticalPodAutoscaler: Layers,
};

// Sockets are laid out in fixed pixel steps from below the header rather than
// as a percentage of node height: percentages put five handles 13px apart on a
// collapsed card, so 14px sockets overlapped into one smear.
const HEADER_HEIGHT = 44;
const HANDLE_STEP = 16;
const HANDLE_SIZE = 11;

/** Enough room for whichever side has more sockets, and no more. */
function nodeMinHeight(inputs: number, outputs: number): number {
  return HEADER_HEIGHT + Math.max(inputs, outputs, 2) * HANDLE_STEP + 8;
}

function NodeHandle({
  spec, index, side,
}: {
  spec: HandleSpec;
  index: number;
  side: "input" | "output";
}) {
  const isInput = side === "input";
  return (
    <Handle
      type={isInput ? "target" : "source"}
      position={isInput ? Position.Left : Position.Right}
      id={`${side}-${spec.type}`}
      className={`!rounded-sm !border-2 !border-neutral-900 !transition-transform hover:!scale-125 ${
        isInput ? "!-ml-1" : "!-mr-1"
      }`}
      style={{
        backgroundColor: spec.color,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
        top: HEADER_HEIGHT + index * HANDLE_STEP,
        zIndex: 10,
      }}
      title={`${spec.label}: ${spec.kinds.join(", ")}`}
    />
  );
}

export default memo(function K8sNode({ data, id, selected }: NodeProps<NodeData>) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(data.name);
  const updateNodeData = useCanvasStore(state => state.updateNodeData);

  const statusStyle = darkStatusStyle(data.status);
  const Icon = iconMap[data.kind] || Box;
  const inputs = inputsFor(data.kind);
  const outputs = outputsFor(data.kind);
  const isImported = data.origin === "cluster";

  const commitName = () => {
    const next = editedName?.trim();
    if (next && next !== data.name) {
      updateNodeData(id, { name: next });
    } else {
      setEditedName(data.name);
    }
    setIsEditingName(false);
  };

  return (
    <div
      className={`relative min-w-[260px] max-w-[280px] rounded-md border bg-neutral-900 transition-colors ${
        selected ? "border-blue-500" : "border-neutral-700 hover:border-neutral-600"
      }`}
    >
      {inputs.map((spec, idx) => (
        <NodeHandle key={spec.type} spec={spec} index={idx} side="input" />
      ))}

      <div
        className="rounded-t-md border-b border-neutral-800 px-3 py-2"
        style={{ backgroundColor: `${data.color}12` }}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 flex-shrink-0" style={{ color: data.color }} />

          <div className="flex min-w-0 flex-1 flex-col">
            {isEditingName ? (
              <input
                type="text"
                value={editedName}
                onChange={e => setEditedName(e.target.value)}
                onBlur={commitName}
                onKeyDown={e => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    setEditedName(data.name);
                    setIsEditingName(false);
                  }
                }}
                onClick={e => e.stopPropagation()}
                autoFocus
                className="w-full rounded border border-blue-500 bg-neutral-800 px-1 py-0.5 text-xs font-semibold text-gray-100 focus:outline-none"
              />
            ) : (
              <span
                className="cursor-text truncate text-xs font-semibold text-gray-100 transition-colors hover:text-blue-400"
                onDoubleClick={e => {
                  e.stopPropagation();
                  setIsEditingName(true);
                  setEditedName(data.name);
                }}
                title="Double-click to rename"
              >
                {data.name}
              </span>
            )}
            <span className="font-mono text-[10px] text-gray-500">{data.kind}</span>
          </div>

          {/* The graph checks found something wrong with this resource. The
              summary is the tooltip; the full reason is in the inspector. */}
          {data.issueCount ? (
            <span title={data.issueSummary} aria-label={`${data.issueCount} issues`}>
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-yellow-500" />
            </span>
          ) : null}

          {isImported && (
            <span title="Imported from the cluster — only edited fields are applied">
              <CloudDownload className="h-3 w-3 flex-shrink-0 text-sky-400" />
            </span>
          )}
          <span
            className={`h-2 w-2 flex-shrink-0 rounded-full ${statusStyle.dot}`}
            title={data.statusMessage || data.status}
          />
        </div>
      </div>

      <div
        className="flex flex-col justify-center gap-1 rounded-b-md bg-neutral-900 px-3 py-2"
        style={{ minHeight: nodeMinHeight(inputs.length, outputs.length) - HEADER_HEIGHT }}
      >
        <div className="flex items-center justify-between gap-2 text-[10px]">
          <span className="truncate font-mono text-gray-500">{data.namespace || "default"}</span>
          <span className={`${statusStyle.text} flex-shrink-0 font-medium`}>{data.status}</span>
        </div>
        <Summary data={data} />
      </div>

      {outputs.map((spec, idx) => (
        <NodeHandle key={spec.type} spec={spec} index={idx} side="output" />
      ))}
    </div>
  );
});

/** One line of the most useful detail for the card. */
function Summary({ data }: { data: NodeData }) {
  const f = (key: string, fallback: FieldValue = "") => fieldValue(data, key) ?? fallback;

  const line = (() => {
    switch (data.kind) {
      case "HelmRelease":
        return data.chart ? `${data.chart.repository}/${data.chart.name}` : "";
      case "Deployment":
      case "StatefulSet":
        return f("image") ? `${f("image")} ×${f("replicas", 1)}` : `Replicas: ${f("replicas", 1)}`;
      case "DaemonSet":
      case "Pod":
      case "Job":
        return f("image");
      case "CronJob":
        return f("schedule");
      case "Service":
        return `${f("serviceType", "ClusterIP")} :${f("port", 80)}`;
      case "Ingress":
        return f("host");
      case "PersistentVolumeClaim":
      case "PersistentVolume":
        return f("storageSize");
      case "HorizontalPodAutoscaler":
        return `${f("minReplicas", 1)}–${f("maxReplicas", 10)} @ ${f("targetCPU", 80)}% CPU`;
      default:
        return "";
    }
  })();

  if (!line) return null;
  return <div className="truncate text-[10px] text-gray-400">{line}</div>;
}
