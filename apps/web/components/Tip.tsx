"use client";

import { useState, useSyncExternalStore } from "react";
import { Lightbulb } from "lucide-react";
import { DismissButton, useDismissed } from "./Dismiss";

export type TipArea = "canvas" | "deployed" | "inspector";

/**
 * The things people use k8n for weeks without finding. One list, shown one at
 * a time where each one applies, and all together on the Help page.
 */
export const TIPS: { area: TipArea; text: string }[] = [
  { area: "canvas", text: "Ctrl+K runs anything by name — add a kind, apply, switch cluster, start the tour." },
  { area: "canvas", text: "Press / to search the palette; Enter adds the best match to the canvas." },
  { area: "canvas", text: "Double-click a card to edit it where it is; double-click its name to rename it." },
  { area: "canvas", text: "Drag from a coloured socket to another card to wire them. The colour says what the wire becomes." },
  { area: "canvas", text: "Review & apply has a Changes tab: exactly what applying would change, from a server-side dry run." },
  { area: "canvas", text: "Your canvas is kept in this browser as you go — a reload brings it back. Ctrl+S saves it as a workflow." },
  { area: "canvas", text: "Ctrl+Z undoes anything on the canvas, the assistant's changes included." },
  { area: "canvas", text: "A yellow triangle on a card is a check that failed. Open the card to read why, and the fix." },
  { area: "canvas", text: "Already running something? Workflows → From your cluster, or bring one stack in from Deployed." },
  { area: "canvas", text: "Helm Charts: search, click a chart, and its Chart tab lists everything it would create before you install." },
  { area: "deployed", text: "Open in browser tunnels a Service or Pod to localhost — how you reach an app inside the cluster." },
  { area: "deployed", text: "Modify on canvas brings one application back as a graph, to change and apply again." },
  { area: "deployed", text: "Reveal values on a Secret shows it decoded, with copy buttons — no base64 one-liners." },
  { area: "deployed", text: "What k8n changed lists every apply, scale, restart and upgrade made from here." },
  { area: "deployed", text: "A pod still starting shows how far it has got — scheduled, pulling its image, starting, ready." },
  { area: "inspector", text: "The Learn tab explains this object at the depth you chose; change it under View → Explanations." },
  { area: "inspector", text: "On a Helm release, Configure lists the chart's own settings, and the search finds nested ones too." },
  { area: "inspector", text: "Only what you change is sent: applying an imported resource cannot strip fields k8n never showed you." },
];

// Chosen once per page load, after hydration, so each visit opens on a
// different tip without the static render disagreeing with the browser.
let start = -1;
const startAt = () => (start < 0 ? (start = Math.floor(Math.random() * TIPS.length)) : start);
const noChange = () => () => {};

export default function Tip({ area, className = "" }: { area: TipArea; className?: string }) {
  const [hidden, hide] = useDismissed("tips");
  const first = useSyncExternalStore(noChange, startAt, () => 0);
  const [step, setStep] = useState(0);
  const list = TIPS.filter(t => t.area === area);
  if (hidden || list.length === 0) return null;

  return (
    <div className={`flex items-start gap-2 rounded-md border border-neutral-800 bg-neutral-900/80 px-3 py-2 text-left text-[11px] leading-relaxed text-gray-400 ${className}`}>
      <Lightbulb className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-yellow-500/80" />
      <span className="min-w-0 flex-1">{list[(first + step) % list.length].text}</span>
      <button onClick={() => setStep(s => s + 1)} className="flex-shrink-0 text-gray-500 hover:text-gray-200">
        Next
      </button>
      <DismissButton onClick={hide} label="Hide tips (Help brings them back)" className="text-gray-500" />
    </div>
  );
}
