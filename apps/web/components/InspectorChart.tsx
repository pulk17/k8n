"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Boxes, Loader2, RefreshCw } from "lucide-react";
import { errorMessage, importManifest, templateHelmChart } from "../lib/api";
import { chartWarnings, imagesIn } from "../lib/chartChecks";
import { NodeData } from "../lib/graph";
import { useCanvasStore } from "../store/canvasStore";
import { notify, notifyError } from "../lib/dialog";

/**
 * What a chart would actually install, fetched as soon as the node exists.
 *
 * Dropping a chart used to buy you a card saying "Ready to Install" and nothing
 * else: the first sight of what was inside it came from the manifest preview,
 * by which point you were one click from running it. The rendering is the same
 * `helm template` the preview uses, so this is not a second opinion — it is the
 * same one, earlier.
 */
export default function InspectorChart({ node }: { node: { id: string; data: NodeData } }) {
  const [yaml, setYaml] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const addChartNodes = useCanvasStore(s => s.addChartNodes);

  const { chart, name, namespace = "default" } = node.data;
  const chartVersion = typeof node.data.chartVersion === "string" ? node.data.chartVersion : "";
  const valuesYaml = typeof node.data.valuesYaml === "string" ? node.data.valuesYaml : "";

  // The request carries the values as they are now, but it is not re-sent on
  // every keystroke in the values box — rendering a chart is a download. The
  // Re-render button is how you ask for the current values.
  useEffect(() => {
    if (!chart?.name) return;
    let cancelled = false;

    setLoading(true);
    setError("");
    templateHelmChart({
      releaseName: name,
      chart: chart.name,
      repoUrl: chart.repositoryUrl,
      version: chartVersion || undefined,
      namespace,
      valuesYaml,
    })
      .then(rendered => {
        if (cancelled) return;
        setYaml(rendered);
      })
      .catch(err => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart?.name, chart?.repositoryUrl, attempt]);

  const handleAddToCanvas = useCallback(async () => {
    setAdding(true);
    try {
      const imported = await importManifest(yaml);
      const added = addChartNodes(node.id, imported);
      notify(`Drew ${added} resource${added === 1 ? "" : "s"} from the chart`, "success");
    } catch (err) {
      notifyError(`Could not draw the chart: ${errorMessage(err)}`);
    } finally {
      setAdding(false);
    }
  }, [yaml, node.id, addChartNodes]);

  if (!chart?.name) {
    return (
      <p className="p-4 text-[11px] leading-relaxed text-gray-500">
        This release has no chart on it. Drag one in from the Helm Charts panel.
      </p>
    );
  }

  const warnings = chartWarnings(yaml);
  const images = imagesIn(yaml);
  const objects = yaml ? yaml.split(/^---$/m).filter(doc => doc.trim()).length : 0;

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-mono text-[11px] text-gray-400">
          {chart.repository}/{chart.name}
          {chartVersion ? `:${chartVersion}` : ""}
        </p>
        <button
          onClick={() => setAttempt(a => a + 1)}
          disabled={loading}
          className="flex flex-shrink-0 items-center gap-1 rounded border border-neutral-700 px-2 py-1 text-[10px] text-gray-400 transition-colors hover:border-neutral-600 hover:text-gray-200 disabled:opacity-50"
          title="Render again with the values as they are now"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Re-render
        </button>
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-[11px] text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Downloading the chart and rendering it…
        </p>
      )}

      {error && (
        <div className="rounded border border-red-900/50 bg-red-950/20 p-2.5">
          <p className="text-[11px] font-medium text-red-300">Could not render this chart</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-400">{error}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
            Rendering downloads the chart and asks the cluster which API versions it supports, so
            it needs both internet access and a connected cluster.
          </p>
        </div>
      )}

      {/* Everything a chart chose for you, said out loud before it runs. */}
      {warnings.map((warning, i) => (
        <div key={i} className="rounded border border-yellow-900/50 bg-yellow-950/20 p-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-yellow-500" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-gray-200">{warning.title}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-400">{warning.why}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-300">
                <span className="text-gray-500">Fix: </span>
                {warning.fix}
              </p>
              {warning.images && (
                <ul className="mt-1.5 space-y-0.5">
                  {warning.images.map(image => (
                    <li key={image} className="truncate font-mono text-[10px] text-yellow-300/80">
                      {image}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ))}

      {yaml && (
        <>
          <div className="flex items-center justify-between gap-2 text-[10px] text-gray-500">
            <span>
              {objects} object{objects === 1 ? "" : "s"} · {images.length} image
              {images.length === 1 ? "" : "s"}
            </span>
          </div>

          <button
            onClick={handleAddToCanvas}
            disabled={adding}
            className="flex w-full items-center justify-center gap-2 rounded border border-blue-800 bg-blue-950/40 px-3 py-2 text-xs font-medium text-blue-200 transition-colors hover:border-blue-700 hover:bg-blue-950/70 disabled:opacity-50"
          >
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Boxes className="h-3.5 w-3.5" />}
            Draw these on the canvas
          </button>
          <p className="text-center text-[10px] leading-relaxed text-gray-600">
            Drawn for reading, not for applying — Helm creates these when the release is
            installed.
          </p>

          <pre className="custom-scrollbar max-h-[40vh] overflow-auto rounded border border-neutral-800 bg-neutral-950 p-2.5 font-mono text-[10px] leading-relaxed text-gray-400">
            {yaml.trim()}
          </pre>
        </>
      )}
    </div>
  );
}
