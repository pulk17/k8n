"use client";

import { useEffect, useState } from "react";
import { Clock, LogOut } from "lucide-react";

/**
 * The public demo's countdown. The demo's front door sets a cookie when a
 * session starts; without it this asks nothing and renders nothing. Asking
 * also tells the door the tab is still open.
 */
export default function DemoBar() {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!document.cookie.includes("k8n_demo_session=")) return;
    let inDemo = false;
    const check = async () => {
      const res = await fetch("/demo/session", { credentials: "same-origin", cache: "no-store" }).catch(() => null);
      const isJson = res?.headers.get("content-type")?.includes("application/json");
      if (res?.ok && isJson) {
        inDemo = true;
        setEndsAt(Date.parse((await res.json()).endsAt));
      } else if (inDemo && isJson) {
        location.href = "/demo/"; // the session ended; the front door says why
      }
    };
    check();
    const poll = setInterval(() => inDemo && check(), 15000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  // At the end, straight to the front door, which says it is over and why.
  useEffect(() => {
    if (endsAt === null) return;
    const t = setTimeout(() => (location.href = "/demo/"), endsAt - Date.now() + 1500);
    return () => clearTimeout(t);
  }, [endsAt]);

  if (endsAt === null) return null;
  const left = Math.max(0, Math.floor((endsAt - now) / 1000));
  const soon = left < 120;

  return (
    <div
      role="status"
      className={`fixed bottom-14 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border px-4 py-1.5 text-xs shadow-lg ${
        soon ? "border-amber-500/60 bg-amber-950/90 text-amber-200" : "border-neutral-700 bg-neutral-900/95 text-gray-300"
      }`}
    >
      <Clock className="h-3.5 w-3.5" />
      <span className="font-mono tabular-nums">
        {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
      </span>
      <span className="hidden sm:inline">
        Live demo. Everything is deleted when it ends{soon ? ": copy your YAML now" : ""}.
      </span>
      <button
        onClick={async () => {
          await fetch("/demo/leave", { method: "POST", credentials: "same-origin" }).catch(() => {});
          location.href = "/demo/";
        }}
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-white/10"
      >
        <LogOut className="h-3.5 w-3.5" /> End session
      </button>
    </div>
  );
}
