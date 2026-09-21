'use client';

import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { X, Play, Loader2, Copy, Download, AlertTriangle, Info, Check } from "lucide-react";
import { Change, CompileNote, diffYaml, errorMessage, fetchHealth } from "../lib/api";
import { applyRisks } from "../lib/applyRisks";
import { chartWarnings } from "../lib/chartChecks";
import { confirmAction } from "../lib/dialog";

interface YamlPreviewProps {
  yaml: string;
  /** Rendered Helm output, shown after the manifest but installed separately. */
  helmYaml?: string;
  objects: number;
  notes: CompileNote[];
  scope: string;
  applying: boolean;
  onApply: () => void;
  onClose: () => void;
}

/**
 * Shows exactly what will be sent to the cluster before anything is applied.
 *
 * Apply used to compile and push in one click, with no way to see the manifest
 * — which mattered most for imported resources, where a regenerated spec could
 * silently overwrite live configuration.
 */
export default function YamlPreview({
  yaml, helmYaml, objects, notes, scope, applying, onApply, onClose,
}: YamlPreviewProps) {
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<"manifest" | "changes">("manifest");
  const [changes, setChanges] = useState<Change[] | string | null>(null);
  const [context, setContext] = useState<string>();

  useEffect(() => {
    fetchHealth().then(h => setContext(h?.context)).catch(() => {});
  }, []);

  /**
   * What applying would do — including what a release's chart renders, so
   * changing a value and pressing Apply is no longer the one path to a cluster
   * with nothing shown first.
   *
   * ponytail: this compares each rendered object with the cluster through a
   * dry-run apply. Helm's own upgrade also removes objects the new values no
   * longer render, and those do not show up here; `helm diff` as a plugin is
   * the upgrade if that starts to matter.
   */
  const showChanges = () => {
    setView("changes");
    if (changes === null) {
      diffYaml(helmYaml ? `${yaml}\n---\n${helmYaml}` : yaml)
        .then(setChanges)
        .catch(err => setChanges(errorMessage(err)));
    }
  };

  // The last word before something reaches a cluster that matters.
  const apply = async () => {
    const risks = applyRisks(yaml, context);
    if (risks.length > 0) {
      const ok = await confirmAction({
        title: "Apply here?",
        message: `${risks.join("\n\n")}\n\nCheck the Changes tab first if you are not sure.`,
        confirmLabel: "Apply anyway",
        danger: true,
      });
      if (!ok) return;
    }
    onApply();
  };

  // Charts are shown after the manifest, separated by a comment, so what a
  // release will create is reviewable even though Helm installs it, not us.
  const shown = helmYaml ? `${yaml}
${helmYaml}` : yaml;
  const hasManifest = shown.trim().length > 0;

  const warnings = notes.filter(n => n.level === "warning");
  const infos = notes.filter(n => n.level === "info");
  // Read from the chart's own rendering. A pod cannot tell you its image does
  // not exist until it has failed to pull it; this can, while Apply is still
  // an unpressed button.
  const chartIssues = chartWarnings(helmYaml || "");

  const copy = async () => {
    await navigator.clipboard.writeText(shown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const blob = new Blob([shown], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "k8n-manifest.yaml";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
      <div className="w-full max-w-4xl h-[80vh] bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 bg-neutral-900">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">Manifest Preview</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {objects} direct {objects === 1 ? "resource" : "resources"}
              {helmYaml ? " · Helm preview included" : ""} · {scope} · dry-run runs before anything is applied
              {context && <> · cluster <span className="font-mono text-gray-400">{context}</span></>}
            </p>
            <div className="mt-2 flex gap-1" role="tablist">
              {(["manifest", "changes"] as const).map(v => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => (v === "changes" ? showChanges() : setView(v))}
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    view === v ? "bg-neutral-700 text-gray-100" : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {v === "manifest" ? "Manifest" : "Changes"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-neutral-800 rounded transition-colors"
              title="Copy YAML"
            >
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            </button>
            <button
              onClick={download}
              className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-neutral-800 rounded transition-colors"
              title="Download YAML"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-neutral-800 rounded transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {chartIssues.length > 0 && (
          <div className="space-y-2 border-b border-neutral-800 bg-amber-950/20 px-4 py-2.5">
            {chartIssues.map((issue, i) => (
              <div key={`c${i}`} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-amber-200">{issue.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-gray-400">{issue.why}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-gray-300">
                    <span className="text-gray-500">Fix: </span>
                    {issue.fix}
                  </p>
                  {issue.images && (
                    <p className="mt-1 truncate font-mono text-[10px] text-amber-300/80">
                      {issue.images.join("  ")}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {(warnings.length > 0 || infos.length > 0) && (
          <div className="px-4 py-2 border-b border-neutral-800 space-y-1 max-h-32 overflow-y-auto custom-scrollbar bg-neutral-950/40">
            {warnings.map((note, i) => (
              <div key={`w${i}`} className="flex gap-2 items-start text-[11px] text-amber-300">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>
                  {note.name ? <span className="font-medium">{note.name}: </span> : null}
                  {note.message}
                </span>
              </div>
            ))}
            {infos.map((note, i) => (
              <div key={`i${i}`} className="flex gap-2 items-start text-[11px] text-sky-300/80">
                <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>
                  {note.name ? <span className="font-medium">{note.name}: </span> : null}
                  {note.message}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0">
          {view === "changes" ? (
            <ChangeList changes={changes} />
          ) : hasManifest ? (
            <Editor
              height="100%"
              defaultLanguage="yaml"
              value={shown}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                wordWrap: "on",
                padding: { top: 12 },
              }}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
              Nothing to apply — the graph compiled to no resources.
            </div>
          )}
        </div>

        {/* What this button does, said in the tool everyone else is using.
            k8n is a front end for the same API, and being explicit about that
            is the difference between learning Kubernetes here and learning
            only k8n. */}
        {hasManifest && (
          <div className="border-t border-neutral-800 px-4 py-2.5">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              The same thing in kubectl
            </p>
            <div className="space-y-1">
              <CommandLine
                command="kubectl apply --dry-run=server -f manifest.yaml"
                note="the validation step"
              />
              <CommandLine command="kubectl apply -f manifest.yaml" note="then, if it passed" />
              {helmYaml && (
                <CommandLine
                  command="helm upgrade --install <release> <chart> --repo <url>"
                  note="charts are installed by Helm, not applied as this YAML"
                />
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-neutral-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-300 hover:bg-neutral-800 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={apply}
            disabled={applying || !hasManifest}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Dry-run &amp; Apply
          </button>
        </div>
      </div>
    </div>
  );
}

const ACTION_STYLE: Record<Change["action"], string> = {
  create: "bg-green-900/40 text-green-300",
  update: "bg-amber-900/40 text-amber-300",
  unchanged: "bg-neutral-800 text-gray-400",
  error: "bg-red-900/40 text-red-300",
};

/** What Apply would do to the live cluster, as `kubectl diff` would show it. */
function ChangeList({ changes }: { changes: Change[] | string | null }) {
  if (changes === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Comparing with the cluster…
      </div>
    );
  }
  if (typeof changes === "string") {
    return <p className="p-4 text-sm text-red-300">{changes}</p>;
  }
  return (
    <div className="custom-scrollbar h-full space-y-3 overflow-y-auto p-4">
      {changes.map(c => (
        <div key={c.resource}>
          <p className="flex items-center gap-2 text-xs">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${ACTION_STYLE[c.action]}`}>
              {c.action === "unchanged" ? "no change" : c.action}
            </span>
            <span className="font-mono text-gray-200">{c.resource}</span>
            {c.action === "create" && <span className="text-gray-500">new — not in the cluster yet</span>}
          </p>
          {c.error && <p className="mt-1 text-[11px] text-red-300">{c.error}</p>}
          {c.diff && (
            <pre className="mt-1 overflow-x-auto rounded bg-neutral-950 p-2 font-mono text-[11px] leading-relaxed">
              {c.diff.split("\n").map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith("+") && !line.startsWith("+++")
                      ? "text-green-400"
                      : line.startsWith("-") && !line.startsWith("---")
                        ? "text-red-400"
                        : "text-gray-500"
                  }
                >
                  {line || " "}
                </div>
              ))}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

/** One equivalent command, with a word on which part of Apply it stands for. */
function CommandLine({ command, note }: { command: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <code className="font-mono text-[11px] text-gray-300">{command}</code>
      <span className="text-[10px] text-gray-600">— {note}</span>
    </div>
  );
}
