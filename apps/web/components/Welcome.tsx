"use client";

import { useState } from "react";
import { ArrowRight, GraduationCap } from "lucide-react";
import { Depth, DEPTHS, useLearningStore } from "../store/learningStore";

/**
 * The first thing anyone sees.
 *
 * It asks one question, because the honest answer to "how much should this
 * explain" is different for every reader and there is no way to guess it. The
 * choice is saved and can be changed later from the View menu, so nobody is
 * stuck with an answer they gave before they knew what the app was.
 */
export default function Welcome({
  onStartTour,
  onSkip,
}: {
  onStartTour: () => void;
  onSkip: () => void;
}) {
  const setDepth = useLearningStore(s => s.setDepth);
  const [picked, setPicked] = useState<Depth>("new");

  const choose = (next: () => void) => () => {
    setDepth(picked);
    next();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl">
        <div className="border-b border-neutral-800 px-6 py-5">
          <h1 className="text-lg font-semibold text-gray-100">Welcome to k8n</h1>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">
            A canvas for Kubernetes: drag objects, wire them together, and see the YAML and the
            kubectl behind every one of them. First — how much Kubernetes should it explain?
          </p>
        </div>

        <div className="space-y-2 p-4" role="radiogroup" aria-label="How much to explain">
          {DEPTHS.map(option => (
            <button
              key={option.id}
              role="radio"
              aria-checked={picked === option.id}
              onClick={() => setPicked(option.id)}
              className={`w-full rounded-md border px-3.5 py-3 text-left transition-colors ${
                picked === option.id
                  ? "border-blue-500 bg-blue-950/30"
                  : "border-neutral-800 bg-neutral-950 hover:border-neutral-700"
              }`}
            >
              <span className="block text-sm font-medium text-gray-100">{option.label}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-400">
                {option.blurb}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-neutral-800 bg-neutral-950/50 px-4 py-3">
          <button
            onClick={choose(onSkip)}
            className="rounded px-3 py-2 text-xs text-gray-400 transition-colors hover:bg-neutral-800 hover:text-gray-200"
          >
            Just open the canvas
          </button>
          <button
            onClick={choose(onStartTour)}
            className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500"
          >
            <GraduationCap className="h-4 w-4" />
            Show me around a real app
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
