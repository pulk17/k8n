"use client";

import { useEffect, useMemo, useState } from "react";
import { Node } from "reactflow";
import { ArrowLeft, ArrowRight, GraduationCap, X } from "lucide-react";
import { useCanvasStore } from "../store/canvasStore";
import { Depth, useLearningStore } from "../store/learningStore";
import { NodeData } from "../lib/graph";
import { conceptFor, kubectlFor } from "../lib/concepts";
import { inputsFor, outputsFor } from "../lib/connections";

/**
 * A walk through a real application, one object at a time.
 *
 * The canvas already holds a working web app when this starts, so nothing here
 * is a toy: every card the tour stops at is a resource that would be created
 * for real. What it says about each one depends on the depth the reader chose —
 * the same seven stops explain what a Deployment *is* to one person and what
 * k8n does with it to another.
 */

interface Step {
  nodeId?: string;
  title: string;
  lead: string;
  points: string[];
}

function stepFor(node: Node<NodeData>, depth: Depth): Step {
  const { kind, name, namespace = "default" } = node.data;
  const concept = conceptFor(kind);

  if (!concept) {
    return { nodeId: node.id, title: `${name} · ${kind}`, lead: `A ${kind}.`, points: [] };
  }

  if (depth === "expert") {
    const wires = [
      ...outputsFor(kind).map(s => `${s.label} → ${s.kinds.join(", ")}`),
      ...inputsFor(kind).map(s => `${s.label} ← ${s.kinds.join(", ")}`),
    ];
    return {
      nodeId: node.id,
      title: `${name} · ${kind}`,
      lead: `Compiles to a ${kind}. Fields on the card map straight onto its spec.`,
      points: [...wires.slice(0, 3), ...concept.kubectl.map(c => kubectlFor(c, name, namespace))],
    };
  }

  if (depth === "some") {
    return {
      nodeId: node.id,
      title: `${name} · ${kind}`,
      lead: concept.keyIdea,
      points: concept.gotchas,
    };
  }

  return {
    nodeId: node.id,
    title: `${name} · ${kind}`,
    lead: concept.analogy,
    points: [concept.whatItDoes, concept.keyIdea, ...concept.gotchas.slice(0, 1)],
  };
}

export default function Tour({
  onExit,
  focusNode,
}: {
  onExit: () => void;
  focusNode: (nodeId: string) => void;
}) {
  const nodes = useCanvasStore(s => s.nodes) as Node<NodeData>[];
  const depth = useLearningStore(s => s.depth);
  const [index, setIndex] = useState(0);

  const steps = useMemo<Step[]>(() => {
    const opening: Step =
      depth === "expert"
        ? {
            title: "What this is",
            lead: "A graph compiler for Kubernetes objects, with a live cluster attached.",
            points: [
              "Edges are not decoration: they resolve into selectors, backends, scale targets and volumes at compile time.",
              "Nothing reaches the cluster without a server-side dry run first.",
            ],
          }
        : {
            title: "A real application, on one canvas",
            lead:
              "This is a working web application: the thing that runs your code, the address " +
              "other people reach it on, its settings, its passwords, and the rule that gives " +
              "it more copies when it gets busy.",
            points: [
              "Kubernetes splits an application into separate objects, each doing one job. The lines between these cards are the relationships between them.",
              "Nothing here has touched a cluster. You are looking at a plan.",
            ],
          };

    const closing: Step = {
      title: "That's the shape of it",
      lead: "Everything else in k8n is a way to look at these same objects.",
      points: [
        "Double-click a card to edit it; the panel button opens the inspector, where the Learn tab explains that object at any time.",
        "Review & apply shows the exact YAML and runs a dry run before anything is created.",
        "The strip along the bottom lists what would break, with the reason and the fix.",
      ],
    };

    return [opening, ...nodes.map(node => stepFor(node, depth)), closing];
  }, [nodes, depth]);

  const step = steps[Math.min(index, steps.length - 1)];

  // Selecting the card the step is about is what ties the words to the canvas —
  // it has to be a real selection, so the card is actually highlighted.
  const stepNodeId = step?.nodeId;
  useEffect(() => {
    if (!stepNodeId) return;
    useCanvasStore.getState().selectOnly(stepNodeId);
    focusNode(stepNodeId);
    // Keyed on the id, not the step object: the steps are rebuilt whenever the
    // nodes change, and selecting changes the nodes.
  }, [stepNodeId, focusNode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
      if (e.key === "ArrowRight") setIndex(i => Math.min(i + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setIndex(i => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit, steps.length]);

  if (!step) return null;
  const last = index === steps.length - 1;

  return (
    <div className="absolute bottom-4 left-1/2 z-40 w-[30rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-lg border border-blue-900/60 bg-neutral-900 shadow-2xl">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-800 bg-blue-950/30 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <GraduationCap className="h-4 w-4 flex-shrink-0 text-blue-400" />
          <h2 className="truncate text-xs font-semibold text-gray-100">{step.title}</h2>
        </div>
        <button
          onClick={onExit}
          className="flex-shrink-0 rounded p-1 text-gray-500 transition-colors hover:bg-neutral-800 hover:text-gray-200"
          aria-label="Leave the tour"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="max-h-[38vh] space-y-2 overflow-y-auto px-4 py-3">
        <p className="text-sm leading-relaxed text-gray-200">{step.lead}</p>
        <ul className="space-y-1.5">
          {step.points.map(point => (
            <li key={point} className="flex gap-2 text-[11px] leading-relaxed text-gray-400">
              <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-blue-700" />
              {point.startsWith("kubectl") ? (
                <code className="font-mono text-[10px] text-gray-300">{point}</code>
              ) : (
                <span>{point}</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-neutral-800 bg-neutral-950/50 px-3 py-2">
        <span className="text-[10px] text-gray-500">
          {index + 1} of {steps.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIndex(i => Math.max(i - 1, 0))}
            disabled={index === 0}
            className="flex items-center gap-1 rounded px-2.5 py-1.5 text-[11px] text-gray-400 transition-colors hover:bg-neutral-800 hover:text-gray-200 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>
          <button
            onClick={() => (last ? onExit() : setIndex(i => i + 1))}
            className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-500"
          >
            {last ? "Start building" : "Next"}
            {!last && <ArrowRight className="h-3 w-3" />}
          </button>
        </div>
      </div>
    </div>
  );
}
