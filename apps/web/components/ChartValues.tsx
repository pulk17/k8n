"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RotateCcw, Search } from "lucide-react";
import { errorMessage, fetchChartValues } from "../lib/api";
import { memo } from "../lib/cache";
import {
  Section,
  allSections,
  matches,
  matchingLines,
  parseCustom,
  sectionText,
  setSection,
  splitDefaults,
} from "../lib/chartValues";
import { NodeData } from "../lib/graph";

/**
 * A release's settings, as the chart itself lists them.
 *
 * The chart's values.yaml is cut into its top-level settings, each with the
 * author's comment and default; open one, change it, and only what differs
 * from the default is written to the release's Custom Values — which is what
 * Review & apply installs or upgrades with.
 */
export default function ChartValues({
  data,
  onChange,
  onRepository,
}: {
  data: NodeData;
  onChange: (valuesYaml: string) => void;
  /** Records where the chart lives, when the release did not say. */
  onRepository: (url: string) => void;
}) {
  const chart = data.chart;
  const version = typeof data.chartVersion === "string" ? data.chartVersion : "";
  const custom = typeof data.valuesYaml === "string" ? data.valuesYaml : "";

  const [defaults, setDefaults] = useState<Section[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!chart?.name || !chart.repositoryUrl) return;
    let cancelled = false;
    const params = { chart: chart.name, repoUrl: chart.repositoryUrl, version: version || undefined };
    memo(`values:${JSON.stringify(params)}`, () => fetchChartValues(params))
      .then(text => !cancelled && setDefaults(splitDefaults(text)))
      .catch(err => !cancelled && setLoadError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [chart?.name, chart?.repositoryUrl, version]);

  let parsed: Record<string, unknown> = {};
  let customError = "";
  try {
    parsed = parseCustom(custom);
  } catch (err) {
    customError = (err as Error).message;
  }

  const sections = allSections(defaults ?? [], parsed);
  const needle = query.trim().toLowerCase();
  const shown = sections.filter(s => (!changedOnly || s.key in parsed) && matches(s, needle));
  const changed = sections.filter(s => s.key in parsed).length;

  if (!chart?.name) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-medium text-gray-400">Settings</p>
        <p className="text-[10px] text-gray-500">
          {changed} changed{defaults ? ` of ${defaults.length}` : ""}
        </p>
      </div>

      {!chart.repositoryUrl && (
        <div className="space-y-1.5 rounded border border-yellow-900/50 bg-yellow-950/20 p-2">
          <p className="text-[10px] leading-relaxed text-yellow-300/90">
            Helm does not record where a chart came from, and this release was installed before k8n started
            to. Give the chart repository&apos;s URL (the one on its Artifact Hub page) to read its settings
            and upgrade it.
          </p>
          <input
            placeholder="https://…/helm-charts"
            aria-label="Chart repository URL"
            onBlur={e => e.target.value.trim() && onRepository(e.target.value.trim())}
            onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 font-mono text-[11px] text-gray-100 outline-none focus:border-blue-500"
          />
        </div>
      )}

      {loadError && <p className="text-[10px] leading-relaxed text-red-300">Could not read the chart&apos;s settings: {loadError}</p>}
      {!defaults && !loadError && chart.repositoryUrl && (
        <p className="flex items-center gap-2 text-[11px] text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the chart&apos;s settings…
        </p>
      )}

      {defaults && (
        <>
          <div className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-1.5 rounded border border-neutral-700 bg-neutral-800 px-2">
              <Search className="h-3 w-3 text-gray-500" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Find a setting — admin, service, ingress…"
                aria-label="Find a setting"
                className="w-full bg-transparent py-1.5 text-xs text-gray-100 outline-none placeholder:text-gray-600"
              />
            </label>
            <label className="flex items-center gap-1 text-[10px] text-gray-400">
              <input type="checkbox" checked={changedOnly} onChange={e => setChangedOnly(e.target.checked)} className="accent-blue-600" />
              Changed
            </label>
          </div>

          <ul className="max-h-[45vh] divide-y divide-neutral-800 overflow-y-auto rounded border border-neutral-800">
            {shown.length === 0 && <li className="px-2.5 py-2 text-[11px] text-gray-500">No setting matches.</li>}
            {shown.map(section => (
              <SectionRow
                key={section.key}
                section={section}
                inside={matchingLines(section, needle)}
                text={sectionText(section, parsed)}
                changed={section.key in parsed}
                open={open === section.key}
                onToggle={() => setOpen(o => (o === section.key ? null : section.key))}
                onCommit={text => {
                  const result = setSection(custom, section, text);
                  if (result.values !== undefined) onChange(result.values);
                  return result.error;
                }}
              />
            ))}
          </ul>
          <p className="text-[10px] leading-relaxed text-gray-600">
            Helm merges these over the chart&apos;s defaults, so a key you delete keeps its default; set it to{" "}
            <code className="font-mono">null</code> to remove it.
          </p>
        </>
      )}

      <details className="rounded border border-neutral-800 px-2.5 py-1.5">
        <summary className="cursor-pointer text-[11px] text-gray-400">All my changes as YAML</summary>
        <textarea
          value={custom}
          onChange={e => onChange(e.target.value)}
          rows={6}
          spellCheck={false}
          aria-label="Custom values YAML"
          className="mt-2 w-full rounded border border-neutral-700 bg-neutral-900 p-2 font-mono text-[11px] text-gray-200 outline-none focus:border-blue-500"
        />
        {customError && <p className="mt-1 text-[10px] text-red-300">{customError}</p>}
      </details>
    </div>
  );
}

function SectionRow({
  section,
  inside,
  text,
  changed,
  open,
  onToggle,
  onCommit,
}: {
  section: Section;
  /** Lines within this setting that matched the search, if any. */
  inside: string[];
  text: string;
  changed: boolean;
  open: boolean;
  onToggle: () => void;
  /** Returns an error to show, or nothing when it was written. */
  onCommit: (text: string) => string | undefined;
}) {
  // A draft of its own, so half-typed YAML is not thrown away; it is written
  // back each time it parses.
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState<string>();

  return (
    <li>
      <button
        onClick={() => {
          if (!open) {
            setDraft(text);
            setError(undefined);
          }
          onToggle();
        }}
        className="flex w-full items-start gap-1.5 px-2.5 py-1.5 text-left hover:bg-neutral-800/60"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-500" /> : <ChevronRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-500" />}
        <span className="min-w-0 flex-1">
          <span className="font-mono text-[11px] text-gray-200">{section.key}</span>
          {changed && <span className="ml-1.5 rounded bg-blue-950 px-1 text-[9px] text-blue-300">changed</span>}
          {section.comment && (
            <span className="block truncate text-[10px] text-gray-500">{section.comment.replace(/^#+\s*/gm, "").split("\n")[0]}</span>
          )}
          {inside.map(line => (
            <span key={line} className="block truncate font-mono text-[10px] text-blue-300/70">
              {line}
            </span>
          ))}
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 px-2.5 pb-2.5">
          <textarea
            value={draft}
            onChange={e => {
              setDraft(e.target.value);
              setError(onCommit(e.target.value));
            }}
            rows={Math.min(18, Math.max(3, draft.split("\n").length + 1))}
            spellCheck={false}
            aria-label={`Value of ${section.key}`}
            className="w-full rounded border border-neutral-700 bg-neutral-900 p-2 font-mono text-[11px] leading-relaxed text-gray-200 outline-none focus:border-blue-500"
          />
          {error && <p className="text-[10px] text-red-300">{error}</p>}
          {changed && (
            <button
              onClick={() => {
                setDraft(section.defaultText);
                setError(onCommit(""));
              }}
              className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-200"
            >
              <RotateCcw className="h-3 w-3" /> Back to the chart&apos;s default
            </button>
          )}
        </div>
      )}
    </li>
  );
}
