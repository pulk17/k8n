'use client';

import { useState } from "react";
import Editor from "@monaco-editor/react";
import { X, Play, Loader2, Copy, Download, AlertTriangle, Info, Check } from "lucide-react";
import { CompileNote } from "../lib/api";

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

  // Charts are shown after the manifest, separated by a comment, so what a
  // release will create is reviewable even though Helm installs it, not us.
  const shown = helmYaml ? `${yaml}
${helmYaml}` : yaml;
  const hasManifest = shown.trim().length > 0;

  const warnings = notes.filter(n => n.level === "warning");
  const infos = notes.filter(n => n.level === "info");

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
            </p>
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
          {hasManifest ? (
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
            onClick={onApply}
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

/** One equivalent command, with a word on which part of Apply it stands for. */
function CommandLine({ command, note }: { command: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <code className="font-mono text-[11px] text-gray-300">{command}</code>
      <span className="text-[10px] text-gray-600">— {note}</span>
    </div>
  );
}
