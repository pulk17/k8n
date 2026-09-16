'use client';

import { Download, MousePointerClick, RefreshCw, Terminal } from 'lucide-react';
import { API_URL } from '../lib/api';

const RELEASES = 'https://github.com/pulk17/k8n/releases';

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
export default function ApiConnectionError({ error, onRetry, onExplore }: ApiConnectionErrorProps) {
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
            href={RELEASES}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center gap-3 rounded-md border border-neutral-800 px-4 py-3 transition-colors hover:border-neutral-700 hover:bg-neutral-800/50"
          >
            <Download className="h-4 w-4 flex-shrink-0 text-gray-400" />
            <span>
              <span className="block text-sm font-medium text-gray-200">Download k8n</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-500">
                One file for macOS, Linux or Windows. Run it and it prints a link to open.
              </span>
            </span>
          </a>

          <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              <Terminal className="h-3 w-3" />
              Already running it?
            </p>
            <p className="text-[11px] leading-relaxed text-gray-400">
              This page tried{' '}
              <code className="font-mono text-gray-300">
                {API_URL || "this page's own address"}
              </code>
              . Check that it matches the address k8n printed, and that you opened its pairing
              link.
            </p>
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
