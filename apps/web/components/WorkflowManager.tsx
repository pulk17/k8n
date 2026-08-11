"use client";

import { useCallback, useEffect, useState } from "react";
import { Node } from "reactflow";
import {
  Boxes,
  Download,
  FileCode,
  FileJson,
  FileText,
  FileType,
  Globe,
  LayoutTemplate,
  LineChart,
  LucideIcon,
  Plus,
  Timer,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCanvasStore } from "../store/canvasStore";
import { compileGraph, errorMessage, importManifest } from "../lib/api";
import { makeEdge, makeNode, nodeId } from "../lib/graph";
import { dockerfileToGraph } from "../lib/dockerfile";
import { TemplateIcon, templates, getAllCategories, getTemplatesByCategory } from "../lib/templates";
import {
  WorkflowSummary,
  deleteWorkflow,
  listWorkflows,
  loadWorkflow,
  saveWorkflow,
} from "../lib/workflows";
import { confirmAction, notify, notifyError } from "../lib/dialog";

interface WorkflowManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadWorkflow: (type: "new" | "example" | "cluster" | "saved", id?: string) => void;
}

type ImportKind = "yaml" | "json" | "dockerfile";

const IMPORT_LABELS: Record<ImportKind, string> = {
  yaml: "YAML",
  json: "JSON",
  dockerfile: "Dockerfile",
};

const IMPORT_HINTS: Record<ImportKind, string> = {
  yaml: "Kubernetes manifests. Multiple resources separated by --- are supported; connections are read from the manifest's own references.",
  json: "A workflow previously exported from k8n.",
  dockerfile: "FROM, EXPOSE and ENV are read to sketch a Deployment, Service and ConfigMap. It is a starting point, not a translation.",
};

const TEMPLATE_ICONS: Record<TemplateIcon, LucideIcon> = {
  web: Globe,
  microservices: Boxes,
  observability: LineChart,
  batch: Timer,
};

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function WorkflowManager({ isOpen, onClose, onLoadWorkflow }: WorkflowManagerProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [importContent, setImportContent] = useState("");
  const [importing, setImporting] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [category, setCategory] = useState("all");

  const { nodes, edges, graphName, graphId, activeNamespace, setGraph } = useCanvasStore();
  const hasWork = nodes.length > 0;

  const refresh = useCallback(async () => {
    setLoading(true);
    setWorkflows(await listWorkflows());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen) refresh();
  }, [isOpen, refresh]);

  /** Every path that replaces the canvas goes through here. */
  const replaceCanvas = async (action: () => void | Promise<void>) => {
    if (hasWork) {
      const ok = await confirmAction({
        title: "Replace the current canvas?",
        message: "Anything you have not saved will be lost.",
        confirmLabel: "Replace",
        danger: true,
      });
      if (!ok) return;
    }
    await action();
  };

  const saveCurrent = async () => {
    try {
      const { source } = await saveWorkflow(
        { name: graphName, namespace: activeNamespace, nodes, edges },
        graphId
      );
      notify(
        source === "database" ? "Saved to the database" : "Saved in this browser (no database)",
        "success"
      );
      refresh();
    } catch (err) {
      notifyError(`Could not save: ${errorMessage(err)}`);
    }
  };

  const open = (summary: WorkflowSummary) =>
    replaceCanvas(async () => {
      try {
        const graph = await loadWorkflow(summary.id, summary.source);
        setGraph(graph.nodes, graph.edges, graph.name);
        onLoadWorkflow("saved", summary.id);
      } catch (err) {
        notifyError(`Could not open that workflow: ${errorMessage(err)}`);
      }
    });

  const remove = async (summary: WorkflowSummary) => {
    const ok = await confirmAction({
      title: "Delete workflow",
      message: `"${summary.name}" will be removed. This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;

    try {
      await deleteWorkflow(summary.id, summary.source);
      refresh();
    } catch (err) {
      notifyError(`Could not delete: ${errorMessage(err)}`);
    }
  };

  const exportYaml = async () => {
    try {
      const { yaml } = await compileGraph(nodes, edges);
      if (!yaml) {
        notify("Nothing on the canvas compiles to a manifest yet");
        return;
      }
      download(`${graphName || "workflow"}.yaml`, yaml, "text/yaml");
    } catch (err) {
      notifyError(`Could not compile the graph: ${errorMessage(err)}`);
    }
  };

  const exportJson = () =>
    download(
      `${graphName || "workflow"}.json`,
      JSON.stringify({ name: graphName, nodes, edges }, null, 2),
      "application/json"
    );

  const loadTemplate = (templateId: string) =>
    replaceCanvas(() => {
      const template = templates.find(t => t.id === templateId);
      if (!template) return;

      const built: Node[] = template.nodes.map(node =>
        makeNode(
          nodeId(node.data.kind),
          node.data.kind,
          node.data.name,
          node.data.namespace || "default",
          node.data
        )
      );

      const builtEdges = template.edges
        .map(e => {
          const source = built[e.sourceIdx];
          const target = built[e.targetIdx];
          return source && target ? makeEdge(source, target) : null;
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);

      setGraph(built, builtEdges, template.name);
      setShowTemplates(false);
      onClose();
    });

  const pickFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = importKind === "yaml" ? ".yaml,.yml" : importKind === "json" ? ".json" : "";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) file.text().then(setImportContent);
    };
    input.click();
  };

  const runImport = async () => {
    if (!importContent.trim() || !importKind) return;
    setImporting(true);
    try {
      if (importKind === "json") {
        const data = JSON.parse(importContent);
        setGraph(data.nodes || [], data.edges || [], data.name || "Imported workflow");
      } else if (importKind === "dockerfile") {
        const graph = dockerfileToGraph(importContent);
        setGraph(graph.nodes, graph.edges, graph.name);
      } else {
        // Parsing manifests is the backend's job: it already has a real YAML
        // decoder and knows how to read references out of a pod spec.
        const result = await importManifest(importContent);
        const byId = new Map<string, Node>();
        for (const n of result.nodes) {
          byId.set(n.id, makeNode(nodeId(n.kind), n.kind, n.name, n.namespace, n.fields));
        }
        const imported = [...byId.values()];
        const importedEdges = result.edges
          .map(e => {
            const source = byId.get(e.source);
            const target = byId.get(e.target);
            return source && target ? makeEdge(source, target) : null;
          })
          .filter((e): e is NonNullable<typeof e> => e !== null);

        setGraph(imported, importedEdges, "Imported manifest");
        for (const note of result.notes) notify(note.message, "info");
      }

      setImportKind(null);
      setImportContent("");
      onClose();
    } catch (err) {
      notifyError(`Import failed: ${errorMessage(err)}`);
    } finally {
      setImporting(false);
    }
  };

  if (!isOpen) return null;

  const actions = [
    {
      key: "templates",
      icon: LayoutTemplate,
      title: "Templates",
      description: `${templates.length} ready-to-use workflows`,
      onClick: () => setShowTemplates(true),
    },
    {
      key: "new",
      icon: Plus,
      title: "New Workflow",
      description: "Start with an empty canvas",
      onClick: () => replaceCanvas(() => onLoadWorkflow("new")),
    },
    {
      key: "example",
      icon: FileText,
      title: "Example Workflow",
      description: "Nginx deployment with a service",
      onClick: () => replaceCanvas(() => onLoadWorkflow("example")),
    },
    {
      key: "cluster",
      icon: Download,
      title: "Import from Cluster",
      description: "Load what is running right now",
      onClick: () => replaceCanvas(() => onLoadWorkflow("cluster")),
    },
    {
      key: "yaml",
      icon: FileCode,
      title: "Import YAML",
      description: "Turn manifests into a graph",
      onClick: () => setImportKind("yaml"),
    },
    {
      key: "json",
      icon: Upload,
      title: "Import JSON",
      description: "Reopen an exported workflow",
      onClick: () => setImportKind("json"),
    },
    {
      key: "dockerfile",
      icon: FileType,
      title: "Import Dockerfile",
      description: "Sketch a workflow from a Dockerfile",
      onClick: () => setImportKind("dockerfile"),
    },
  ];

  const shown = category === "all" ? templates : getTemplatesByCategory(category);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-neutral-800">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Workflows</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {hasWork && (
            <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/20">
              <span className="mr-auto text-sm text-blue-900 dark:text-blue-100">
                {nodes.length} resources on the canvas
              </span>
              <button
                onClick={saveCurrent}
                className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
              >
                Save
              </button>
              <button
                onClick={exportJson}
                className="flex items-center gap-2 rounded bg-neutral-700 px-3 py-2 text-sm text-white hover:bg-neutral-600"
              >
                <FileJson className="h-4 w-4" />
                Export JSON
              </button>
              <button
                onClick={exportYaml}
                className="flex items-center gap-2 rounded bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-700"
              >
                <FileCode className="h-4 w-4" />
                Export YAML
              </button>
            </div>
          )}

          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {actions.map(({ key, icon: Icon, title, description, onClick }) => (
              <button
                key={key}
                onClick={onClick}
                className="group rounded-lg border border-gray-300 p-4 text-left transition-colors hover:border-blue-500 hover:bg-blue-50 dark:border-neutral-700 dark:hover:bg-blue-950/20"
              >
                <Icon className="mb-3 h-7 w-7 text-gray-400 group-hover:text-blue-500" />
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
              </button>
            ))}
          </div>

          <h3 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Saved workflows
          </h3>
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : workflows.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nothing saved yet. Ctrl+S on the canvas saves the current workflow.
            </p>
          ) : (
            <div className="space-y-2">
              {workflows.map(workflow => (
                <div
                  key={`${workflow.source}-${workflow.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-neutral-700 dark:bg-neutral-800"
                >
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate font-semibold text-gray-900 dark:text-gray-100">
                      {workflow.name}
                    </h4>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {workflow.namespace} • {new Date(workflow.updatedAt).toLocaleString()} •{" "}
                      {workflow.source === "database" ? "database" : "this browser"}
                    </p>
                  </div>
                  <button
                    onClick={() => open(workflow)}
                    className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => remove(workflow)}
                    className="rounded p-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/20"
                    title="Delete workflow"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {importKind && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-neutral-800">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Import {IMPORT_LABELS[importKind]}
              </h2>
              <button
                onClick={() => setImportKind(null)}
                className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <button
                onClick={pickFile}
                className="mb-4 flex w-full items-center justify-center gap-2 rounded bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700"
              >
                <Upload className="h-5 w-5" />
                Choose a file
              </button>
              <textarea
                value={importContent}
                onChange={e => setImportContent(e.target.value)}
                placeholder={`…or paste the ${IMPORT_LABELS[importKind]} here`}
                className="h-80 w-full rounded border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800"
              />
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {IMPORT_HINTS[importKind]}
              </p>
            </div>

            <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-neutral-800">
              <button
                onClick={() => setImportKind(null)}
                className="rounded px-4 py-2 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                onClick={runImport}
                disabled={!importContent.trim() || importing}
                className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {importing ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTemplates && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-neutral-800">
              <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-gray-100">
                <LayoutTemplate className="h-6 w-6 text-blue-500" />
                Templates
              </h2>
              <button
                onClick={() => setShowTemplates(false)}
                className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto border-b border-gray-200 px-6 py-3 dark:border-neutral-800">
              {["all", ...getAllCategories()].map(name => (
                <button
                  key={name}
                  onClick={() => setCategory(name)}
                  className={`whitespace-nowrap rounded px-3 py-1 text-sm font-medium ${
                    category === name
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-neutral-800 dark:text-gray-300"
                  }`}
                >
                  {name === "all" ? "All" : name}
                </button>
              ))}
            </div>

            <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-6 md:grid-cols-2 lg:grid-cols-3">
              {shown.map(template => (
                <button
                  key={template.id}
                  onClick={() => loadTemplate(template.id)}
                  className="group rounded-lg border-2 border-gray-200 p-4 text-left transition-all hover:border-blue-500 hover:bg-blue-50 dark:border-neutral-800 dark:hover:bg-blue-950/20"
                >
                  {(() => {
                    const Icon = TEMPLATE_ICONS[template.icon];
                    return <Icon className="mb-3 h-7 w-7 text-gray-400 group-hover:text-blue-500" />;
                  })()}
                  <h3 className="mb-1 font-semibold text-gray-900 group-hover:text-blue-600 dark:text-gray-100">
                    {template.name}
                  </h3>
                  <p className="mb-2 text-xs text-gray-600 dark:text-gray-400">
                    {template.description}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="rounded bg-gray-100 px-2 py-0.5 dark:bg-neutral-800">
                      {template.category}
                    </span>
                    <span>{template.nodes.length} resources</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
