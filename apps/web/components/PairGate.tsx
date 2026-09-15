"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { UNAUTHORIZED_EVENT, setToken, stripTokenFromUrl } from "../lib/session";

/**
 * Asks for the pairing token when this browser has not been paired.
 *
 * k8n prints a link containing the token; following it pairs silently and this
 * never appears. It exists for the other ways people arrive — a bookmark, a
 * second browser, a hosted page pointed at a local k8n, or a token that was
 * regenerated since. Nothing here can be bypassed by guessing: it simply lets
 * the user paste what the terminal printed.
 */
export default function PairGate() {
  const [asking, setAsking] = useState(false);
  const [value, setValue] = useState("");

  useEffect(() => {
    // The token arrived in the link and is saved by now; this is the first
    // moment it can be removed from the URL without Next putting it back.
    stripTokenFromUrl();

    const onUnauthorized = () => setAsking(true);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (!asking) return null;

  const pair = () => {
    const token = value.trim();
    if (!token) return;
    setToken(token);
    // A reload is the honest way to redo everything that failed while unpaired,
    // rather than teaching every panel to retry itself.
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-neutral-800 px-5 py-4">
          <KeyRound className="h-4 w-4 text-blue-400" />
          <h2 className="text-sm font-semibold text-gray-100">Pair with your k8n</h2>
        </div>

        <div className="space-y-3 p-5">
          <p className="text-xs leading-relaxed text-gray-400">
            This browser has not been paired with the k8n running on your machine. When k8n starts
            it prints a link — open that link and you are paired. Or paste its token here.
          </p>

          <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Look for this in the terminal
            </p>
            <code className="block break-all font-mono text-[11px] text-gray-400">
              Open this link to pair your browser: http://127.0.0.1:8080/?t=…
            </code>
          </div>

          <form
            onSubmit={e => {
              e.preventDefault();
              pair();
            }}
            className="flex gap-2"
          >
            <input
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="Paste the token"
              aria-label="Pairing token"
              autoFocus
              className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2.5 py-2 font-mono text-xs text-gray-100 placeholder:text-neutral-600 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!value.trim()}
              className="rounded bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
            >
              Pair
            </button>
          </form>

          <p className="text-[10px] leading-relaxed text-gray-600">
            The token lets this browser read and change the cluster k8n is connected to. Treat it
            like a password, and do not paste it into a page you did not open yourself.
          </p>
        </div>
      </div>
    </div>
  );
}
