"use client";

import { useEffect, useState } from "react";
import type { Startup } from "@/lib/api";

const STEPS = ["Node", "Image", "Start", "Health check"];

function elapsed(since: string | undefined, now: number): string {
  if (!since) return "";
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * Where a pod is on its way up. Kubernetes never says how much of an image has
 * downloaded, so this shows the stage and how long it has been in it — which
 * is what tells "a big image on a slow link" apart from "stuck".
 */
export default function StartupBar({ startup, compact = false }: { startup: Startup; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const time = elapsed(startup.since, now);

  return (
    <div
      role="progressbar"
      aria-label="Start-up progress"
      aria-valuemin={0}
      aria-valuemax={STEPS.length}
      aria-valuenow={startup.step - 1}
      aria-valuetext={`${startup.label}${time ? `, ${time}` : ""}`}
      className={compact ? "mt-1.5" : "mt-2"}
    >
      <div className="flex gap-1">
        {STEPS.map((name, i) => {
          const n = i + 1;
          const tone =
            n < startup.step
              ? "bg-emerald-500"
              : n === startup.step
                ? "bg-blue-500 animate-pulse"
                : "bg-gray-200 dark:bg-neutral-700";
          return <div key={name} title={name} className={`h-1.5 flex-1 rounded-full ${tone}`} />;
        })}
      </div>
      <p className={`mt-1 text-blue-600 dark:text-blue-400 ${compact ? "text-[10px]" : "text-xs"}`}>
        {startup.label}
        {time && <span className="text-gray-500 dark:text-gray-400"> · {time}</span>}
        {!compact && (
          <span className="text-gray-400">
            {" "}
            (step {startup.step} of {STEPS.length})
          </span>
        )}
      </p>
    </div>
  );
}
