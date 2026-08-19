"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2, Eye, FolderOpen, HelpCircle, Loader2, Play, RefreshCw, Save, SlidersHorizontal,
} from "lucide-react";

export type ApplyState = "idle" | "dry-running" | "applying" | "success" | "error";

/**
 * The bar across the top of the canvas.
 *
 * Two things changed from the row of seven identical grey buttons this used to
 * be. "Preview YAML" and "Apply to Cluster" were nearly the same action —
 * Apply compiled and opened the preview, and the preview is where you applied
 * from — so there is now one primary button, and the preview stays the only
 * door to the cluster. And the buttons are grouped by what they act on: the
 * workflow on the left, what you are looking at on the right, with the one
 * action that changes your cluster set apart in blue.
 */

interface CanvasToolbarProps {
  graphName: string;
  onGraphNameChange: (name: string) => void;
  dirty: boolean;

  applyState: ApplyState;
  busy: boolean;
  canApply: boolean;

  onOpenWorkflows: () => void;
  onSave: () => void;
  onRefresh: () => void;
  onReviewAndApply: () => void;

  namespaces: string[];
  activeNamespace: string;
  onNamespaceChange: (ns: string) => void;

  showPods: boolean;
  onShowPodsChange: (value: boolean) => void;
  showSystemNamespaces: boolean;
  onShowSystemNamespacesChange: (value: boolean) => void;
}

export default function CanvasToolbar({
  graphName, onGraphNameChange, dirty,
  applyState, busy, canApply,
  onOpenWorkflows, onSave, onRefresh, onReviewAndApply,
  namespaces, activeNamespace, onNamespaceChange,
  showPods, onShowPodsChange,
  showSystemNamespaces, onShowSystemNamespacesChange,
}: CanvasToolbarProps) {
  const applyLabel =
    applyState === "dry-running" ? "Validating…"
    : applyState === "applying" ? "Applying…"
    : "Review & apply";

  return (
    <header className="absolute inset-x-0 top-0 z-40 flex h-12 items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-3">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-blue-600 text-[11px] font-bold text-white"
          aria-hidden
        >
          k8n
        </span>
        <input
          type="text"
          value={graphName}
          onChange={e => onGraphNameChange(e.target.value)}
          aria-label="Workflow name"
          placeholder="Untitled workflow"
          className="w-44 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-gray-100 outline-none transition-colors placeholder:text-gray-600 hover:border-neutral-700 hover:bg-neutral-800 focus:border-blue-500 focus:bg-neutral-800"
        />
        {dirty && (
          <span
            className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400"
            title="You have unsaved changes"
            aria-label="Unsaved changes"
          />
        )}
      </div>

      <Divider />

      {/* Workflow actions. Icon-only with tooltips: they are used often enough
          to want the space back, and each one has a keyboard shortcut. */}
      <IconButton icon={FolderOpen} label="Workflows" onClick={onOpenWorkflows} />
      <IconButton icon={Save} label="Save  (Ctrl+S)" onClick={onSave} />
      <IconButton icon={RefreshCw} label="Refresh from cluster  (Ctrl+R)" onClick={onRefresh} />

      <div className="ml-auto flex items-center gap-2">
        {applyState === "success" && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            Applied
          </span>
        )}

        <label className="flex items-center gap-2 rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1.5">
          <span className="text-xs font-medium text-gray-400">Scope</span>
          <select
            value={activeNamespace}
            onChange={e => onNamespaceChange(e.target.value)}
            title="Only resources in this scope are shown, previewed and applied"
            className="cursor-pointer border-none bg-transparent text-sm text-gray-200 outline-none"
          >
            <option value="all">All namespaces</option>
            {namespaces.map(ns => (
              <option key={ns} value={ns}>{ns}</option>
            ))}
          </select>
        </label>

        <Menu label="View" icon={SlidersHorizontal}>
          <Toggle
            checked={showPods}
            onChange={onShowPodsChange}
            label="Show pods and ReplicaSets"
            hint="Off by default: a controller's pods repeat what the controller already tells you, and there can be a lot of them."
          />
          <Toggle
            checked={showSystemNamespaces}
            onChange={onShowSystemNamespacesChange}
            label="Show system namespaces"
            hint="kube-system and friends. Cluster machinery you almost never want on the canvas."
          />
          <p className="border-t border-neutral-800 px-3 py-2 text-[10px] leading-snug text-gray-500">
            These change what gets imported from the cluster. Refresh to pick them up.
          </p>
        </Menu>

        <button
          onClick={onReviewAndApply}
          disabled={busy || !canApply}
          title="Compile the graph, review the YAML, then dry-run and apply"
          className="flex items-center gap-2 rounded bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {applyLabel}
        </button>

        <Divider />

        <IconButton icon={Eye} label="Deployed resources" href="/deployed" />
        <IconButton icon={HelpCircle} label="Help" href="/help" />
      </div>
    </header>
  );
}

function Divider() {
  return <span className="h-5 w-px flex-shrink-0 bg-neutral-800" aria-hidden />;
}

/**
 * An icon button that is still announced by its name. `title` alone gives a
 * tooltip but leaves the button nameless to a screen reader, which is how you
 * end up with a toolbar that reads as "button button button".
 */
function IconButton({
  icon: Icon,
  label,
  onClick,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const className =
    "flex h-8 w-8 items-center justify-center rounded text-gray-400 transition-colors hover:bg-neutral-800 hover:text-gray-100";

  if (href) {
    return (
      <Link href={href} title={label} aria-label={label} className={className}>
        <Icon className="h-4 w-4" />
      </Link>
    );
  }
  return (
    <button onClick={onClick} title={label} aria-label={label} className={className}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

/** A small dropdown that closes on outside click and on Escape. */
function Menu({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex items-center gap-1.5 rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-neutral-700"
      >
        <Icon className="h-4 w-4" />
        {label}
      </button>

      {open && (
        <div className="animate-panel-in absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl">
          {children}
        </div>
      )}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer gap-2.5 px-3 py-2.5 transition-colors hover:bg-neutral-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-blue-500"
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-gray-200">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-snug text-gray-500">{hint}</span>
      </span>
    </label>
  );
}
