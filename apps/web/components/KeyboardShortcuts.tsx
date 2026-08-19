'use client';

import { useEffect, useState } from "react";
import { X } from "lucide-react";

interface KeyboardShortcutsProps {
  onSave: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo?: () => void;
}

/** True for anything that swallows a keystroke as text or a choice. */
const isFormField = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement;

export default function KeyboardShortcuts({ onSave, onRefresh, onDelete, onUndo, onRedo }: KeyboardShortcutsProps) {
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Show/hide help with "?"
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowHelp(!showHelp);
        return;
      }

      // Hide help on Escape
      if (e.key === 'Escape' && showHelp) {
        setShowHelp(false);
        return;
      }

      // Don't trigger shortcuts while typing. Selects count: the inspector has
      // several, and Delete over an open one used to delete the whole node.
      if (isFormField(e.target)) {
        return;
      }

      // Ctrl+Shift+Z or Ctrl+Y to redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        onRedo?.();
        return;
      }

      // Ctrl+Z to undo (must check after redo since Ctrl+Shift+Z also has e.key === 'z')
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        onUndo();
      }

      // Ctrl+S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave();
      }

      // Ctrl+R to refresh
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        onRefresh();
      }

      // Delete key
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!isFormField(e.target)) {
          e.preventDefault();
          // Small delay to ensure selection state is updated
          setTimeout(() => {
            onDelete();
          }, 10);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSave, onRefresh, onDelete, onUndo, onRedo, showHelp]);

  if (!showHelp) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800 max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Keyboard Shortcuts</h3>
          <button
            onClick={() => setShowHelp(false)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center p-2 bg-gray-50 dark:bg-neutral-800 rounded">
            <span className="text-gray-700 dark:text-gray-300">Undo</span>
            <kbd className="px-2 py-1 bg-gray-200 dark:bg-neutral-700 rounded text-xs font-mono">Ctrl+Z</kbd>
          </div>

          <div className="flex justify-between items-center p-2 bg-gray-50 dark:bg-neutral-800 rounded">
            <span className="text-gray-700 dark:text-gray-300">Redo</span>
            <kbd className="px-2 py-1 bg-gray-200 dark:bg-neutral-700 rounded text-xs font-mono">Ctrl+Shift+Z</kbd>
          </div>

          <div className="flex justify-between items-center p-2 bg-gray-50 dark:bg-neutral-800 rounded">
            <span className="text-gray-700 dark:text-gray-300">Save Graph</span>
            <kbd className="px-2 py-1 bg-gray-200 dark:bg-neutral-700 rounded text-xs font-mono">Ctrl+S</kbd>
          </div>

          <div className="flex justify-between items-center p-2 bg-gray-50 dark:bg-neutral-800 rounded">
            <span className="text-gray-700 dark:text-gray-300">Refresh from Cluster</span>
            <kbd className="px-2 py-1 bg-gray-200 dark:bg-neutral-700 rounded text-xs font-mono">Ctrl+R</kbd>
          </div>

          <div className="flex justify-between items-center p-2 bg-gray-50 dark:bg-neutral-800 rounded">
            <span className="text-gray-700 dark:text-gray-300">Delete Selected</span>
            <kbd className="px-2 py-1 bg-gray-200 dark:bg-neutral-700 rounded text-xs font-mono">Delete</kbd>
          </div>

          <div className="flex justify-between items-center p-2 bg-gray-50 dark:bg-neutral-800 rounded">
            <span className="text-gray-700 dark:text-gray-300">Show/Hide Help</span>
            <kbd className="px-2 py-1 bg-gray-200 dark:bg-neutral-700 rounded text-xs font-mono">?</kbd>
          </div>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 mt-4 text-center">
          Press ? or Esc to close
        </p>
      </div>
    </div>
  );
}
