'use client';

import { memo, useState } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import {
  Box, Database, Globe, FileCode, Lock, Layers, Briefcase, Clock, Network,
  ChevronDown, ChevronUp, CloudDownload, AlertTriangle, LucideIcon,
} from "lucide-react";
import { useCanvasStore } from "../store/canvasStore";
import { fieldsFor, FieldSpec } from "../lib/nodeSchema";
import { inputsFor, outputsFor, HandleSpec } from "../lib/connections";
import { FieldValue, NodeData, fieldValue } from "../lib/graph";

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

const statusColors: Record<string, { bg: string; text: string; dot: string }> = {
  Running: { bg: "bg-green-950/20", text: "text-green-400", dot: "bg-green-500" },
  Ready: { bg: "bg-green-950/20", text: "text-green-400", dot: "bg-green-500" },
  Active: { bg: "bg-green-950/20", text: "text-green-400", dot: "bg-green-500" },
  "Ready to Install": { bg: "bg-blue-950/20", text: "text-blue-400", dot: "bg-blue-500" },
  "Not Deployed": { bg: "bg-gray-950/20", text: "text-gray-400", dot: "bg-gray-400" },
  Pending: { bg: "bg-yellow-950/20", text: "text-yellow-400", dot: "bg-yellow-500" },
  NotReady: { bg: "bg-yellow-950/20", text: "text-yellow-400", dot: "bg-yellow-500" },
  Failed: { bg: "bg-red-950/20", text: "text-red-400", dot: "bg-red-500" },
  Error: { bg: "bg-red-950/20", text: "text-red-400", dot: "bg-red-500" },
  CrashLoopBackOff: { bg: "bg-red-950/20", text: "text-red-400", dot: "bg-red-500" },
  Completed: { bg: "bg-blue-950/20", text: "text-blue-400", dot: "bg-blue-500" },
  Unknown: { bg: "bg-gray-950/20", text: "text-gray-400", dot: "bg-gray-400" },
};

const inputClass =
  "w-full px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-100 " +
  "focus:outline-none focus:ring-1 focus:ring-blue-500";

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

function Field({
  spec, value, onChange,
}: {
  spec: FieldSpec;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
}) {
  const label = (
    <label className="block text-[10px] font-medium text-gray-400 mb-1">{spec.label}</label>
  );
  const hint = spec.hint ? (
    <p className="text-[9px] text-gray-500 mt-1 leading-snug">{spec.hint}</p>
  ) : null;

  if (spec.type === "checkbox") {
    return (
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value === true}
            onChange={e => onChange(e.target.checked)}
            className="w-3.5 h-3.5 accent-blue-500"
          />
          <span className="text-[10px] font-medium text-gray-400">{spec.label}</span>
        </label>
        {hint}
      </div>
    );
  }

  return (
    <div>
      {label}
      {spec.type === "select" ? (
        <select
          value={String(value ?? spec.options?.[0] ?? "")}
          onChange={e => onChange(e.target.value)}
          className={inputClass}
        >
          {spec.options?.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : spec.type === "textarea" ? (
        <textarea
          value={String(value ?? "")}
          onChange={e => onChange(e.target.value)}
          placeholder={spec.placeholder}
          rows={spec.rows ?? 3}
          className={`${inputClass} font-mono`}
        />
      ) : spec.type === "number" ? (
        <input
          type="number"
          min={spec.min}
          max={spec.max}
          value={value === undefined ? "" : String(value)}
          onChange={e => {
            const raw = e.target.value;
            onChange(raw === "" ? undefined : Number(raw));
          }}
          placeholder={spec.placeholder}
          className={inputClass}
        />
      ) : (
        <input
          type="text"
          value={String(value ?? "")}
          onChange={e => onChange(e.target.value)}
          placeholder={spec.placeholder}
          className={inputClass}
        />
      )}
      {hint}
    </div>
  );
}

export default memo(function K8sNode({ data, id, selected }: NodeProps<NodeData>) {
  const [expanded, setExpanded] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(data.name);
  const updateNodeData = useCanvasStore(state => state.updateNodeData);

  const statusStyle = statusColors[data.status ?? ""] || statusColors.Unknown;
  const Icon = iconMap[data.kind] || Box;
  const inputs = inputsFor(data.kind);
  const outputs = outputsFor(data.kind);
  const fields = fieldsFor(data.kind);
  const isImported = data.origin === "cluster";

  const setField = (key: string, value: FieldValue) => updateNodeData(id, { [key]: value });

  const commitName = () => {
    const next = editedName?.trim();
    if (next && next !== data.name) {
      setField("name", next);
    } else {
      setEditedName(data.name);
    }
    setIsEditingName(false);
  };

  return (
    <div
      className={`relative min-w-[280px] max-w-[300px] rounded border bg-neutral-900 transition-colors ${
        selected ? "border-blue-500 shadow-lg shadow-blue-500/20" : "border-neutral-700"
      }`}
    >
      {inputs.map((spec, idx) => (
        <NodeHandle key={spec.type} spec={spec} index={idx} side="input" />
      ))}

      <div
        className="px-3 py-2 border-b border-neutral-800 cursor-pointer hover:bg-neutral-800/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
        style={{ backgroundColor: `${data.color}10` }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Icon className="w-4 h-4 flex-shrink-0" style={{ color: data.color }} />
            <div className="flex flex-col flex-1 min-w-0">
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
                  className="text-xs font-semibold bg-neutral-800 text-gray-100 px-1 py-0.5 rounded border border-blue-500 focus:outline-none w-full"
                />
              ) : (
                <span
                  className="text-xs font-semibold text-gray-100 truncate cursor-text hover:text-blue-400 transition-colors"
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
              <span className="text-[10px] text-gray-400 font-mono">{data.kind}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isImported && (
              <span title="Imported from the cluster — only edited fields are applied">
                <CloudDownload className="w-3 h-3 text-sky-400" />
              </span>
            )}
            <div className={`w-2 h-2 rounded-full ${statusStyle.dot}`} title={data.status} />
            {expanded ? (
              <ChevronUp className="w-3 h-3 text-gray-400" />
            ) : (
              <ChevronDown className="w-3 h-3 text-gray-400" />
            )}
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="px-3 py-2 space-y-2 text-xs bg-neutral-900 max-h-[420px] overflow-y-auto custom-scrollbar">
          {isImported && (
            <div className="flex gap-1.5 px-2 py-1.5 bg-sky-950/30 border border-sky-900/40 rounded">
              <AlertTriangle className="w-3 h-3 text-sky-400 flex-shrink-0 mt-0.5" />
              <p className="text-[9px] text-sky-300 leading-snug">
                Live cluster resource. Applying sends only the fields you change, so the
                rest of its spec is left untouched.
              </p>
            </div>
          )}

          <Field
            spec={{ key: "namespace", label: "Namespace", type: "text", placeholder: "default" }}
            value={data.namespace ?? "default"}
            onChange={v => setField("namespace", v)}
          />

          {data.kind === "HelmRelease" && data.chart && (
            <div>
              <label className="block text-[10px] font-medium text-gray-400 mb-1">Chart</label>
              <div className="px-2 py-1 text-xs border border-neutral-700 rounded bg-neutral-800 text-gray-300">
                {data.chart.repository}/{data.chart.name}
              </div>
            </div>
          )}

          {fields
            .filter(f => !f.visibleWhen || f.visibleWhen(data))
            .map(f => (
              <Field
                key={f.key}
                spec={f}
                value={fieldValue(data, f.key)}
                onChange={v => setField(f.key, v)}
              />
            ))}

          <div className={`px-2 py-1 ${statusStyle.bg} rounded flex items-center gap-2`}>
            <div className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
            <span className={`text-[10px] font-medium ${statusStyle.text}`}>{data.status}</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col justify-center gap-1 bg-neutral-900 px-3 py-2"
             style={{ minHeight: nodeMinHeight(inputs.length, outputs.length) - HEADER_HEIGHT }}>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-gray-400 font-mono truncate">{data.namespace || "default"}</span>
            <span className={`${statusStyle.text} font-medium flex-shrink-0`}>{data.status}</span>
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

/** One line of the most useful detail for the collapsed card. */
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
  return <div className="text-[10px] text-gray-400 truncate">{line}</div>;
}
