'use client';

import { useEffect, useState } from "react";

interface KeyboardShortcutsProps {
  onSave: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  onUndo: () => void;
}

export default function KeyboardShortcuts({ onSave, onRefresh, onDelete, onUndo }: KeyboardShortcutsProps) {
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

      // Don't trigger shortcuts if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Ctrl+Z to undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
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
        if (!(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          onDelete();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSave, onRefresh, onDelete, onUndo, showHelp]);

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
            ✕
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center p-2 bg-gray-50 dark:bg-neutral-800 rounded">
            <span className="text-gray-700 dark:text-gray-300">Undo</span>
            <kbd className="px-2 py-1 bg-gray-200 dark:bg-neutral-700 rounded text-xs font-mono">Ctrl+Z</kbd>
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
