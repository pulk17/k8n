import { Edge, Node } from "reactflow";
import { DEFAULT_RESOURCE_COLOR, RESOURCE_COLORS } from "./constants";
import { getConnectionType, isAnimatedType } from "./connections";

/**
 * What a canvas node carries.
 *
 * The named fields are the ones every node has; the rest are per-kind and
 * open-ended on purpose, because the set of them is decided by NODE_SCHEMA and
 * by whatever a CRD needs. They are read through `fieldValue`, not by name.
 */
export interface NodeData {
  kind: string;
  name: string;
  namespace: string;
  status?: string;
  /** Why the status is what it is, when the cluster says. Set by the watch
      stream, so it is only ever present on imported nodes. */
  statusMessage?: string;
  /** Set by the canvas from lib/graphChecks, purely so the card can show a
      badge. Kept as primitives to avoid a cycle between the two modules. */
  issueCount?: number;
  issueSummary?: string;
  /** "cluster" means imported — only edited fields are ever applied. */
  origin?: "canvas" | "cluster";
  color?: string;
  /** Which fields the user changed on an imported node. */
  __edited?: Record<string, boolean>;
  chart?: { name: string; description?: string; repository: string; repositoryUrl?: string };
  [field: string]: unknown;
}

/** The value types the node editor can hold. */
export type FieldValue = string | number | boolean | undefined;

export const fieldValue = (data: NodeData, key: string): FieldValue => {
  const value = data[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : undefined;
};

// Nodes and edges get built in five places (starter workflow, templates, YAML
// and Dockerfile import, AI patches). These two functions are how they are all
// built, so an edge always carries the styling its connection type implies.

export function makeNode(
  id: string,
  kind: string,
  name: string,
  namespace: string,
  fields: Record<string, unknown> = {}
): Node<NodeData> {
  return {
    id,
    type: "k8sNode",
    position: { x: 0, y: 0 },
    data: {
      status: "Not Deployed",
      ...fields,
      // After the spread: a caller passing stale node data (templates once
      // carried their own hex colours) must not override the node's identity or
      // the palette.
      kind,
      name,
      namespace,
      origin: "canvas",
      color: RESOURCE_COLORS[kind] || DEFAULT_RESOURCE_COLOR,
    },
  };
}

/** Handle ids. K8sNode renders its sockets with exactly these. */
export const sourceHandleId = (type: string) => `output-${type}`;
export const targetHandleId = (type: string) => `input-${type}`;

/**
 * An edge always terminates on the socket for its connection type.
 *
 * Without the explicit handle ids React Flow falls back to the node's first
 * handle, so every incoming edge — config, storage, scaling — piled onto the
 * same point and the coloured sockets meant nothing.
 */
export function makeEdge(source: Node, target: Node): Edge {
  const { type, color } = getConnectionType(source.data.kind, target.data.kind);
  return {
    id: `${source.id}->${target.id}`,
    source: source.id,
    target: target.id,
    sourceHandle: sourceHandleId(type),
    targetHandle: targetHandleId(type),
    animated: isAnimatedType(type),
    style: { stroke: color, strokeWidth: 2 },
    data: { edgeType: type },
  };
}

/** Ids only have to be unique within a canvas. */
export const nodeId = (kind: string) =>
  `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
