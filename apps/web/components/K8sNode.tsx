"use client";

import { memo, useState } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import {
  Box, Database, Globe, FileCode, Lock, Layers, Briefcase, Clock, Network,
  ChevronDown, ChevronUp, CloudDownload, AlertTriangle, PanelRight, Package, LucideIcon,
} from "lucide-react";
import { useCanvasStore } from "../store/canvasStore";
import { inputsFor, outputsFor, HandleSpec } from "../lib/connections";
import { CLUSTER_SCOPED, FieldValue, NodeData, fieldValue } from "../lib/graph";
import { fieldsFor } from "../lib/nodeSchema";
import { darkStatusStyle } from "../lib/constants";
import FieldInput from "./FieldInput";
import StartupBar from "./StartupBar";

/**
 * A resource on the canvas.
 *
 * Collapsed, the card is what you want while reading the shape of a graph:
 * name, kind, where it lives, whether it is healthy, and the one detail that
 * identifies it. The chevron opens the common fields in place — near your
 * hands, where you are already looking — and the panel button hands the same
 * resource to the dock on the right, which has the room for everything else:
 * what it teaches, what is wrong with it, and what the cluster says about it.
 *
 * Only expansion is in place; a card never opens on selection, because a graph
 * where clicking anything reflows everything else is unreadable.
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
  const [expanded, setExpanded] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(data.name);
  const updateNodeData = useCanvasStore(state => state.updateNodeData);
  const inspectNode = useCanvasStore(state => state.inspectNode);

  const statusStyle = darkStatusStyle(data.status);
  const Icon = iconMap[data.kind] || Box;
  const inputs = inputsFor(data.kind);
  const outputs = outputsFor(data.kind);
  const isImported = data.origin === "cluster";
  const isFromChart = data.origin === "helm";

  const setField = (key: string, value: FieldValue) => updateNodeData(id, { [key]: value });

  // Same rule as the inspector's Name field: take what was typed and let the
  // graph checks judge it. Trimming and silently reverting an empty name here
  // meant the two ways of renaming a resource behaved differently.
  const commitName = () => {
    updateNodeData(id, { name: editedName });
    setIsEditingName(false);
  };

  return (
    <div
      className={`group relative min-w-[260px] max-w-[280px] rounded-md bg-neutral-900 transition-colors ${
        // Dashed says "k8n is not the one that creates this" — the same reading
        // as a ghost in any editor.
        isFromChart ? "border border-dashed" : "border"
      } ${selected ? "border-blue-500" : "border-neutral-700 hover:border-neutral-600"}`}
    >
      {inputs.map((spec, idx) => (
        <NodeHandle key={spec.type} spec={spec} index={idx} side="input" />
      ))}

      <div
        className="rounded-t-md border-b border-neutral-800 px-3 py-2"
        style={{ backgroundColor: `${data.color}12` }}
        onDoubleClick={() => setExpanded(open => !open)}
        title={expanded ? "Double-click to collapse" : "Double-click to edit here"}
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

          {isFromChart && (
            <span title="Rendered from a Helm chart — Helm creates this, not k8n">
              <Package className="h-3 w-3 flex-shrink-0 text-violet-400" />
            </span>
          )}

          <span
            className={`h-2 w-2 flex-shrink-0 rounded-full ${statusStyle.dot}`}
            title={data.statusMessage || data.status}
          />

          {/* nodrag keeps React Flow from treating a press on these as the
              start of a drag, which otherwise swallows the click. */}
          <button
            onClick={() => inspectNode(id)}
            className="nodrag flex-shrink-0 rounded p-0.5 text-gray-500 transition-colors hover:bg-neutral-800 hover:text-gray-200"
            title="Open in the inspector — Learn, live status and every field"
            aria-label="Open in the inspector"
          >
            <PanelRight className="h-3.5 w-3.5" />
          </button>

          {/* Kept for the keyboard and for screen readers, which have no
              double-click; visible only when the card already has focus. */}
          <button
            onClick={() => setExpanded(open => !open)}
            className="nodrag flex-shrink-0 rounded p-0.5 text-gray-500 opacity-0 transition-opacity focus:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={expanded ? "Collapse this card" : "Expand this card"}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {data.startup && (
        <div className="px-3 pb-2">
          <StartupBar compact startup={data.startup} />
        </div>
      )}

      {expanded ? (
        // nowheel is React Flow's opt-out: without it the wheel zooms the canvas
        // instead of scrolling this form, which is unusable the moment a card
        // has more fields than fit.
        <div
          className="custom-scrollbar nodrag nowheel max-h-[360px] space-y-2 overflow-y-auto rounded-b-md bg-neutral-900 px-3 py-2"
          onDoubleClick={e => e.stopPropagation()}
        >
          {!CLUSTER_SCOPED.includes(data.kind) && (
            <FieldInput
              spec={{ key: "namespace", label: "Namespace", type: "text", placeholder: "default" }}
              value={data.namespace ?? "default"}
              onChange={v => setField("namespace", v)}
            />
          )}

          {data.kind === "HelmRelease" && data.chart && (
            <div>
              <p className="mb-1 text-[10px] font-medium text-gray-400">Chart</p>
              <p className="truncate rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-gray-300">
                {data.chart.repository}/{data.chart.name}
              </p>
            </div>
          )}

          {fieldsFor(data.kind)
            .filter(f => !f.visibleWhen || f.visibleWhen(data))
            .map(f => (
              <FieldInput
                key={f.key}
                spec={f}
                value={fieldValue(data, f.key)}
                onChange={v => setField(f.key, v)}
              />
            ))}

          <button
            onClick={() => inspectNode(id)}
            className="flex w-full items-center justify-center gap-1.5 rounded border border-neutral-700 px-2 py-1.5 text-[10px] text-gray-400 transition-colors hover:border-neutral-600 hover:text-gray-200"
          >
            <PanelRight className="h-3 w-3" />
            {data.kind === "HelmRelease" ? "What this chart installs" : "Learn, checks and live status"}
          </button>
        </div>
      ) : (
        <div
          // The header is mostly the name, and double-clicking *that* renames.
          // The body is the rest of the card, and is the bigger target for
          // "open this up".
          onDoubleClick={() => setExpanded(true)}
          className="flex flex-col justify-center gap-1 rounded-b-md bg-neutral-900 px-3 py-2"
          style={{ minHeight: nodeMinHeight(inputs.length, outputs.length) - HEADER_HEIGHT }}
        >
          <div className="flex items-center justify-between gap-2 text-[10px]">
            <span className="truncate font-mono text-gray-500">{CLUSTER_SCOPED.includes(data.kind) ? "cluster-wide" : data.namespace || "default"}</span>
            <span className={`${statusStyle.text} flex-shrink-0 font-medium`}>{data.status}</span>
          </div>
          <Summary data={data} />
        </div>
      )}

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
