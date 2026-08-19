"use client";

import { useEffect, useState } from "react";
import { Edge, Node } from "reactflow";
import { AlertTriangle, ArrowRight, GraduationCap, Info, Radio, Sliders, Trash2, X } from "lucide-react";
import { useCanvasStore } from "../store/canvasStore";
import { fieldsFor } from "../lib/nodeSchema";
import { FieldValue, NodeData, fieldValue } from "../lib/graph";
import { getConnectionType } from "../lib/connections";
import { CONNECTION_CONCEPTS, conceptFor } from "../lib/concepts";
import { CONNECTION_TYPES, darkStatusStyle } from "../lib/constants";
import { GraphIssue } from "../lib/graphChecks";
import FieldInput from "./FieldInput";
import InspectorLearn from "./InspectorLearn";
import InspectorLive from "./InspectorLive";

/**
 * One dock on the right of the canvas, for whatever is selected.
 *
 * Before this, editing a resource meant expanding the node card in place —
 * which shoved the rest of the graph around every time you opened one — and
 * logs, metrics and events each arrived as their own floating window pinned to
 * `top-20 right-4`. Opening two of them stacked one on top of the other.
 *
 * Everything that describes a selection now lands here, in a column that is
 * always in the same place and never covers the graph you are editing.
 */

export const INSPECTOR_WIDTH = 340;

type Tab = "configure" | "learn" | "live";

interface InspectorProps {
  selectedEdge: Edge | null;
  /** Graph checks for the selected node. Computed by the canvas, which already
      runs them for the badges and the status strip. */
  issues: GraphIssue[];
  onClose: () => void;
}

export default function Inspector({ selectedEdge, issues, onClose }: InspectorProps) {
  const nodes = useCanvasStore(s => s.nodes);
  const selectedNodeId = useCanvasStore(s => s.selectedNodeId);
  const updateNodeData = useCanvasStore(s => s.updateNodeData);
  const deleteNode = useCanvasStore(s => s.deleteNode);

  const node = (nodes.find(n => n.id === selectedNodeId) ?? null) as Node<NodeData> | null;

  // Starts on Configure every time. The canvas gives this component a key of
  // whatever is selected, so picking a different resource remounts it and the
  // tab resets on its own — staying on "Live" while selecting a node that has
  // no live half would otherwise show an empty panel.
  const [tab, setTab] = useState<Tab>("configure");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while typing into one of the fields in this very panel.
      const target = e.target as HTMLElement | null;
      const typing = target?.matches?.("input, textarea, select");
      if (e.key === "Escape" && !typing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (selectedEdge) {
    return (
      <Dock onClose={onClose}>
        <EdgeExplanation edge={selectedEdge} nodes={nodes as Node<NodeData>[]} />
      </Dock>
    );
  }

  if (!node) return null;

  const { kind, name, namespace = "default", status, statusMessage, origin } = node.data;
  const isLive = origin === "cluster";
  const setField = (key: string, value: FieldValue) => updateNodeData(node.id, { [key]: value });
  const tone = darkStatusStyle(status);
  const concept = conceptFor(kind);

  return (
    <Dock onClose={onClose}>
      <header className="border-b border-neutral-800 px-4 py-3">
        <div className="flex items-start gap-2">
          <span
            className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-sm"
            style={{ backgroundColor: node.data.color }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-gray-100" title={name}>
              {name}
            </h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className="font-mono">{kind}</span>
              <span>·</span>
              <span className="truncate">{namespace}</span>
              <span className={`ml-auto flex items-center gap-1 ${tone.text}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                {status}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close inspector"
            className="rounded p-1 text-gray-500 transition-colors hover:bg-neutral-800 hover:text-gray-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* The cluster's own reason, when there is one. "CrashLoopBackOff" on a
            status dot tells you something is wrong; this is the line that tells
            you what. Falls back to the concept summary so the space is never
            just empty. */}
        {statusMessage ? (
          <p className={`mt-2 text-[11px] leading-snug ${tone.text}`}>{statusMessage}</p>
        ) : (
          concept && <p className="mt-2 text-[11px] leading-snug text-gray-500">{concept.summary}</p>
        )}
      </header>

      <nav className="flex items-center gap-1 border-b border-neutral-800 px-2" role="tablist">
        <TabButton icon={Sliders} active={tab === "configure"} onClick={() => setTab("configure")}>
          Configure
        </TabButton>
        <TabButton icon={GraduationCap} active={tab === "learn"} onClick={() => setTab("learn")}>
          Learn
        </TabButton>
        {isLive && (
          <TabButton icon={Radio} active={tab === "live"} onClick={() => setTab("live")}>
            Live
          </TabButton>
        )}
      </nav>

      <div className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
        {tab === "configure" && (
          <div className="space-y-3 p-4">
            {/* What is wrong with this resource, and why it matters. Sits above
                the form because the fix is almost always one of the fields
                directly below it. */}
            {issues.map((issue, i) => (
              <div
                key={i}
                className={`rounded border p-2.5 ${
                  issue.level === "warning"
                    ? "border-yellow-900/50 bg-yellow-950/20"
                    : "border-blue-900/50 bg-blue-950/20"
                }`}
              >
                <div className="flex items-start gap-2">
                  {issue.level === "warning" ? (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-yellow-500" />
                  ) : (
                    <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-blue-400" />
                  )}
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-gray-200">{issue.title}</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-gray-400">{issue.why}</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-gray-300">
                      <span className="text-gray-500">Fix: </span>
                      {issue.fix}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            {isLive && (
              <p className="rounded border border-sky-900/40 bg-sky-950/30 px-2.5 py-2 text-[10px] leading-relaxed text-sky-300">
                Imported from the cluster. Applying sends only the fields you change here, so the
                rest of its spec is left exactly as it is.
              </p>
            )}

            <FieldInput
              spec={{ key: "name", label: "Name", type: "text", placeholder: "my-app" }}
              value={name}
              // Straight through: trimming on every keystroke ate the space in
              // "my app", and refusing empty meant you could not clear the box
              // to retype. The compiler already skips unnamed nodes with a note.
              onChange={v => setField("name", String(v ?? ""))}
            />
            <FieldInput
              spec={{
                key: "namespace",
                label: "Namespace",
                type: "text",
                placeholder: "default",
                hint: "Which partition of the cluster this object lives in.",
              }}
              value={namespace}
              onChange={v => setField("namespace", v)}
            />

            {kind === "HelmRelease" && node.data.chart && (
              <div>
                <p className="mb-1 text-[11px] font-medium text-gray-400">Chart</p>
                <p className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-gray-300">
                  {node.data.chart.repository}/{node.data.chart.name}
                </p>
              </div>
            )}

            {fieldsFor(kind)
              .filter(f => !f.visibleWhen || f.visibleWhen(node.data))
              .map(f => (
                <FieldInput
                  key={f.key}
                  spec={f}
                  value={fieldValue(node.data, f.key)}
                  onChange={v => setField(f.key, v)}
                />
              ))}

            <button
              onClick={() => {
                deleteNode(node.id);
                onClose();
              }}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:border-red-800 hover:bg-red-950/60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove from canvas
            </button>
            <p className="text-center text-[10px] text-gray-600">
              This only takes it off the graph. Nothing is deleted from the cluster.
            </p>
          </div>
        )}

        {tab === "learn" && <InspectorLearn kind={kind} name={name} namespace={namespace} />}

        {tab === "live" && isLive && (
          <InspectorLive kind={kind} name={name} namespace={namespace} />
        )}
      </div>
    </Dock>
  );
}

/** The column itself. Kept separate so the edge view gets the same frame. */
function Dock({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <aside
      aria-label="Inspector"
      className="animate-panel-in absolute bottom-0 right-0 top-12 z-30 flex flex-col border-l border-neutral-800 bg-neutral-900"
      style={{ width: INSPECTOR_WIDTH }}
    >
      {/* The edge view has no header of its own, so it needs a way out. */}
      <button onClick={onClose} className="sr-only">
        Close inspector
      </button>
      {children}
    </aside>
  );
}

/** What a selected wire means, in the same words the Learn tab would use. */
function EdgeExplanation({ edge, nodes }: { edge: Edge; nodes: Node<NodeData>[] }) {
  const source = nodes.find(n => n.id === edge.source);
  const target = nodes.find(n => n.id === edge.target);
  if (!source || !target) return null;

  const { type } = getConnectionType(source.data.kind, target.data.kind);
  const concept = CONNECTION_CONCEPTS[type];
  const meta = CONNECTION_TYPES[type];

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-1.5">
        <span
          className="h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: meta.color }}
          aria-hidden
        />
        <h2 className="text-sm font-semibold text-gray-100">{concept.title}</h2>
      </div>

      <div className="flex items-center gap-2 rounded border border-neutral-800 bg-neutral-800/40 p-2.5">
        <Endpoint node={source} />
        <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-600" />
        <Endpoint node={target} />
      </div>

      <p className="text-xs leading-relaxed text-gray-400">{concept.explanation}</p>

      <p className="text-[10px] leading-relaxed text-gray-600">
        Drawing this wire is what makes the compiler fill in the reference — the selector, the
        volume mount, the env source — when it turns the graph into YAML.
      </p>
    </div>
  );
}

function Endpoint({ node }: { node: Node<NodeData> }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs font-medium text-gray-200">{node.data.name}</p>
      <p className="truncate font-mono text-[10px] text-gray-500">{node.data.kind}</p>
    </div>
  );
}

function TabButton({
  icon: Icon,
  active,
  onClick,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-xs font-medium transition-colors ${
        active
          ? "border-blue-500 text-gray-100"
          : "border-transparent text-gray-500 hover:text-gray-300"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}
