"use client";

import { useCallback, useEffect, useState } from "react";
import { Node } from "reactflow";
import {
  Boxes,
  ChevronRight,
  Download,
  FileCode,
  FileJson,
  FileText,
  FileType,
  FolderOpen,
  Globe,
  GraduationCap,
  LineChart,
  LucideIcon,
  Plus,
  Save,
  Timer,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCanvasStore } from "../store/canvasStore";
import { compileGraph, errorMessage, importManifest } from "../lib/api";
import { makeEdge, makeNode, nodeId } from "../lib/graph";
import { dockerfileToGraph } from "../lib/dockerfile";
import { TemplateIcon, templates, templateToGraph } from "../lib/templates";
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
  /** Loads the demo app and starts the walkthrough. */
  onStartTour?: () => void;
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

export default function WorkflowManager({
  isOpen,
  onClose,
  onLoadWorkflow,
  onStartTour,
}: WorkflowManagerProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [importContent, setImportContent] = useState("");
  const [importing, setImporting] = useState(false);

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
        source === "database"
          ? "Saved to the database"
          : source === "file"
            ? "Saved on this machine (~/.k8n/workflows)"
            : "Saved in this browser",
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

      const { nodes: built, edges: builtEdges } = templateToGraph(template);
      setGraph(built, builtEdges, template.name);
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

  // Three things people come here to do, in the order they most often want
  // them: carry on with something saved, start something, or bring something in.
  // They used to be seven identical cards in one grid, with saved work below
  // the fold and templates behind a second dialog.
  const starters: Action[] = [
    {
      key: "new",
      icon: Plus,
      title: "Empty canvas",
      description: "Start from nothing and drag resources in",
      onClick: () => replaceCanvas(() => onLoadWorkflow("new")),
    },
    ...(onStartTour
      ? [
          {
            key: "tour",
            icon: GraduationCap,
            title: "Show me around",
            description: "A real app, explained one object at a time",
            onClick: () =>
              replaceCanvas(() => {
                onClose();
                onStartTour();
              }),
          },
        ]
      : []),
  ];

  const imports: Action[] = [
    {
      key: "cluster",
      icon: Download,
      title: "From your cluster",
      description: "What is running right now",
      onClick: () => replaceCanvas(() => onLoadWorkflow("cluster")),
    },
    {
      key: "yaml",
      icon: FileCode,
      title: "Kubernetes YAML",
      description: "Manifests become a wired graph",
      onClick: () => setImportKind("yaml"),
    },
    {
      key: "json",
      icon: Upload,
      title: "k8n JSON",
      description: "A workflow exported from here",
      onClick: () => setImportKind("json"),
    },
    {
      key: "dockerfile",
      icon: FileType,
      title: "Dockerfile",
      description: "A rough first sketch",
      onClick: () => setImportKind("dockerfile"),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-label="Workflows"
        className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-neutral-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">Workflows</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Carry on with saved work, start something new, or bring in what you already have.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-gray-500 transition-colors hover:bg-neutral-800 hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* What is on the canvas right now, and the three things you can do with
            it. Only there when there is something to act on. */}
        {hasWork && (
          <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-950/60 px-6 py-3">
            <div className="mr-auto min-w-0">
              <p className="truncate text-sm font-medium text-gray-200">{graphName}</p>
              <p className="text-[11px] text-gray-500">
                On the canvas now · {nodes.length} resource{nodes.length === 1 ? "" : "s"}
              </p>
            </div>
            <button
              onClick={saveCurrent}
              className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
            <div className="flex items-stretch overflow-hidden rounded border border-neutral-700">
              <span className="flex items-center border-r border-neutral-700 px-2.5 text-[11px] text-gray-500">
                Export
              </span>
              <button
                onClick={exportYaml}
                title="The compiled Kubernetes manifests"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-300 transition-colors hover:bg-neutral-800"
              >
                <FileCode className="h-3.5 w-3.5" />
                YAML
              </button>
              <button
                onClick={exportJson}
                title="The canvas itself, to reopen in k8n"
                className="flex items-center gap-1.5 border-l border-neutral-700 px-2.5 py-1.5 text-xs text-gray-300 transition-colors hover:bg-neutral-800"
              >
                <FileJson className="h-3.5 w-3.5" />
                JSON
              </button>
            </div>
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_20rem] lg:overflow-hidden">
          <div className="space-y-7 p-6 lg:overflow-y-auto">
            <Section title="Start something new">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {starters.map(({ key, ...action }) => (
                  <BigAction key={key} {...action} />
                ))}
              </div>

              <p className="mb-2 mt-5 text-[11px] font-medium text-gray-500">From a template</p>
              <div className="divide-y divide-neutral-800 overflow-hidden rounded-md border border-neutral-800">
                <Row
                  icon={FileText}
                  title="Nginx starter"
                  description="A Deployment, its Service, a ConfigMap and an Ingress"
                  meta="4 resources"
                  onClick={() => replaceCanvas(() => onLoadWorkflow("example"))}
                />
                {templates.map(template => (
                  <Row
                    key={template.id}
                    icon={TEMPLATE_ICONS[template.icon]}
                    title={template.name}
                    description={template.description}
                    meta={`${template.nodes.length} resources`}
                    onClick={() => loadTemplate(template.id)}
                  />
                ))}
              </div>
            </Section>

            <Section title="Bring in what you have">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {imports.map(({ key, ...action }) => (
                  <SmallAction key={key} {...action} />
                ))}
              </div>
            </Section>
          </div>

          <aside className="border-t border-neutral-800 bg-neutral-950/40 p-6 lg:overflow-y-auto lg:border-l lg:border-t-0">
            <Section title="Your workflows" count={loading ? undefined : workflows.length}>
              {loading ? (
                <p className="text-xs text-gray-500">Loading…</p>
              ) : workflows.length === 0 ? (
                <div className="rounded-md border border-dashed border-neutral-800 p-4 text-center">
                  <FolderOpen className="mx-auto mb-2 h-6 w-6 text-gray-600" />
                  <p className="text-xs text-gray-400">Nothing saved yet.</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                    Ctrl+S on the canvas saves what you are working on, to{" "}
                    <code className="font-mono">~/.k8n/workflows</code>.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {workflows.map(workflow => (
                    <li
                      key={`${workflow.source}-${workflow.id}`}
                      className="group flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900 p-2.5 transition-colors hover:border-neutral-700"
                    >
                      <button
                        onClick={() => open(workflow)}
                        className="min-w-0 flex-1 text-left"
                        title="Open this workflow"
                      >
                        <span className="block truncate text-sm font-medium text-gray-200 group-hover:text-blue-300">
                          {workflow.name}
                        </span>
                        {/* Two short lines rather than one long one: in a
                            20rem column the date pushed "where" off the end. */}
                        <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                          {workflow.namespace} ·{" "}
                          {workflow.source === "browser" ? "this browser" : "this machine"}
                        </span>
                        <span className="block text-[10px] text-gray-600">
                          {new Date(workflow.updatedAt).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      </button>
                      <button
                        onClick={() => remove(workflow)}
                        aria-label={`Delete ${workflow.name}`}
                        className="flex-shrink-0 rounded p-1.5 text-gray-600 opacity-0 transition hover:bg-red-950/40 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </aside>
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

    </div>
  );
}

interface Action {
  key: string;
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {title}
        {count !== undefined && count > 0 && (
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-gray-400">{count}</span>
        )}
      </h3>
      {children}
    </section>
  );
}

/** The two ways to start: big, because they are the whole reason for a first visit. */
function BigAction({ icon: Icon, title, description, onClick }: Omit<Action, "key">) {
  return (
    <button
      onClick={onClick}
      className="group flex items-start gap-3 rounded-md border border-neutral-800 bg-neutral-950 p-4 text-left transition-colors hover:border-blue-700 hover:bg-blue-950/20"
    >
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-neutral-800 text-gray-300 group-hover:bg-blue-900/60 group-hover:text-blue-200">
        <Icon className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-sm font-medium text-gray-100">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{description}</span>
      </span>
    </button>
  );
}

function SmallAction({ icon: Icon, title, description, onClick }: Omit<Action, "key">) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 rounded-md border border-neutral-800 px-3 py-2.5 text-left transition-colors hover:border-neutral-700 hover:bg-neutral-800/50"
    >
      <Icon className="h-4 w-4 flex-shrink-0 text-gray-500 group-hover:text-gray-300" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-gray-200">{title}</span>
        <span className="block truncate text-[11px] text-gray-500">{description}</span>
      </span>
    </button>
  );
}

function Row({
  icon: Icon,
  title,
  description,
  meta,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 bg-neutral-950 px-3 py-2.5 text-left transition-colors hover:bg-neutral-800/60"
    >
      <Icon className="h-4 w-4 flex-shrink-0 text-gray-500 group-hover:text-blue-400" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-gray-200">{title}</span>
        <span className="block truncate text-[11px] text-gray-500">{description}</span>
      </span>
      <span className="flex-shrink-0 text-[10px] text-gray-600">{meta}</span>
      <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-600 group-hover:text-gray-300" />
    </button>
  );
}
