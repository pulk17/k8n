"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpCircle, Server } from "lucide-react";
import { fetchHealth } from "../lib/api";
import { applyRisks } from "../lib/applyRisks";
import { isNewer, latestRelease } from "../lib/version";

/**
 * Which cluster the canvas talks to, always in view — and red when its name
 * says production. Also the one place k8n mentions that a newer release exists.
 */
export default function ClusterBadge() {
  const [context, setContext] = useState<string>();
  const [update, setUpdate] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(async h => {
        setContext(h?.context);
        if (h?.version && h.version !== "dev") {
          const latest = await latestRelease();
          if (latest && isNewer(latest, h.version)) setUpdate(latest);
        }
      })
      .catch(() => {});
  }, []);

  const risky = context ? applyRisks("", context).length > 0 : false;

  return (
    <>
      {context && (
        <Link
          href="/connect"
          title={`Connected to ${context}. Click to switch cluster.`}
          className={`flex max-w-[160px] items-center gap-1.5 rounded border px-2 py-1 text-xs ${
            risky
              ? "border-red-700 bg-red-950/40 text-red-300"
              : "border-neutral-700 text-gray-400 hover:border-neutral-600 hover:text-gray-200"
          }`}
        >
          <Server className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate font-mono">{context}</span>
        </Link>
      )}
      {update && (
        <a
          href="https://github.com/pulk17/k8n/releases/latest"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-emerald-400 hover:underline"
          title="A newer k8n is out"
        >
          <ArrowUpCircle className="h-3.5 w-3.5" />
          {update}
        </a>
      )}
    </>
  );
}
