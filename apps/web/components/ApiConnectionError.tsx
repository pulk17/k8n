'use client';

import { useState } from 'react';
import { Download, MousePointerClick, RefreshCw, Terminal } from 'lucide-react';
import { getEngine, setEngine } from '../lib/session';

interface ApiConnectionErrorProps {
  error: string;
  onRetry?: () => void;
  /** Opens the canvas with no engine behind it. */
  onExplore?: () => void;
}

/**
 * What you see when there is no k8n engine to talk to.
 *
 * This used to be a developer's error page — a stack of "go run main.go"
 * instructions — which is the wrong thing to show the two people who actually
 * meet it: someone who opened a hosted copy of this page with nothing running
 * locally, and someone whose k8n has stopped. Both need the same fact first,
 * which is that k8n runs on your own machine, next to your kubeconfig.
 *
 * The canvas itself needs no engine: you can draw a graph, read what every
 * object is for, and see the checks with nothing running at all. So it offers
 * that rather than being a dead end.
 */
/** Safari will not let a public page reach a program on this machine at all. */
const isSafari = () =>
  typeof navigator !== 'undefined' &&
  /Safari\//.test(navigator.userAgent) &&
  !/Chrome|Chromium|Edg\//.test(navigator.userAgent);

export default function ApiConnectionError({ error, onRetry, onExplore }: ApiConnectionErrorProps) {
  // The hosted copy has an engine address to get wrong; a page the engine
  // served itself does not.
  const hosted = Boolean(getEngine());
  const [address, setAddress] = useState(getEngine());
  const [bad, setBad] = useState(false);

  const connect = () => {
    const ok = setEngine(address.trim());
    setBad(!ok);
    if (ok) onRetry?.();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-4">
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-xl">
        <div className="border-b border-neutral-800 px-6 py-5">
          <h2 className="text-lg font-semibold text-gray-100">k8n runs on your machine</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
            The canvas is just a page; the part that talks to Kubernetes is a single binary you run
            yourself, beside your kubeconfig. Nothing here can reach a cluster until that is
            running — which is also why your cluster credentials never leave your computer.
          </p>
        </div>

        <div className="space-y-3 p-6">
          {onExplore && (
            <button
              onClick={onExplore}
              className="flex w-full items-center gap-3 rounded-md border border-blue-800 bg-blue-950/40 px-4 py-3 text-left transition-colors hover:border-blue-700 hover:bg-blue-950/70"
            >
              <MousePointerClick className="h-4 w-4 flex-shrink-0 text-blue-300" />
              <span>
                <span className="block text-sm font-medium text-blue-100">
                  Look around without a cluster
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-blue-200/70">
                  Draw a graph, read what each object does, see the checks. Compiling and applying
                  need the engine.
                </span>
              </span>
            </button>
          )}

          <a
            href="/setup/"
            className="flex w-full items-center gap-3 rounded-md border border-neutral-800 px-4 py-3 transition-colors hover:border-neutral-700 hover:bg-neutral-800/50"
          >
            <Download className="h-4 w-4 flex-shrink-0 text-gray-400" />
            <span>
              <span className="block text-sm font-medium text-gray-200">Set up k8n</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-500">
                Download it for your system, run it, connect this page — step by step, with every command to copy.
              </span>
            </span>
          </a>

          <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              <Terminal className="h-3 w-3" />
              Already running it?
            </p>
            {hosted ? (
              <>
                <p className="text-[11px] leading-relaxed text-gray-400">
                  Open the second link k8n printed — &ldquo;Or use it from the web&rdquo; — and this page
                  connects by itself. Or give the address it printed:
                </p>
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={e => {
                    e.preventDefault();
                    connect();
                  }}
                >
                  <input
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    aria-label="Engine address"
                    placeholder="http://127.0.0.1:8080"
                    className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-[11px] text-gray-100 outline-none focus:border-blue-500"
                  />
                  <button type="submit" className="rounded bg-blue-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-blue-500">
                    Connect
                  </button>
                </form>
                {bad && (
                  <p className="mt-1.5 text-[11px] text-red-300">
                    Only an address on this machine — 127.0.0.1 or localhost. This page will not send your
                    token anywhere else.
                  </p>
                )}
                {isSafari() ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-yellow-300/90">
                    Safari does not let a website reach a program on your own computer. Use the first link
                    k8n printed, which opens k8n straight from your machine, or open this page in Chrome,
                    Edge or Firefox.
                  </p>
                ) : (
                  <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                    If your browser asks whether this site may reach devices on your network, allow it: that
                    is this page asking to talk to k8n on your machine.
                  </p>
                )}
              </>
            ) : (
              <p className="text-[11px] leading-relaxed text-gray-400">
                This page tried its own address. Check that it matches the address k8n printed, and that
                you opened its pairing link.
              </p>
            )}
            <p className="mt-2 break-all font-mono text-[10px] text-gray-600">{error}</p>
          </div>

          {onRetry && (
            <button
              onClick={onRetry}
              className="flex w-full items-center justify-center gap-2 rounded border border-neutral-800 px-4 py-2 text-xs text-gray-400 transition-colors hover:border-neutral-700 hover:text-gray-200"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
