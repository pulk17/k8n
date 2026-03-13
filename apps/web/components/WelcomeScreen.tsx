'use client';

import { Box, Plus, RefreshCw, FolderOpen } from "lucide-react";

interface WelcomeScreenProps {
  onOpenWorkflowManager: () => void;
}

export default function WelcomeScreen({ onOpenWorkflowManager }: WelcomeScreenProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
      <div className="max-w-2xl mx-auto text-center pointer-events-auto">
        <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded shadow-sm p-8">
          {/* Icon */}
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded mb-6">
            <Box className="w-8 h-8 text-white" />
          </div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Welcome to k8n
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Your visual Kubernetes IDE
          </p>

          {/* Actions */}
          <div className="flex gap-2 justify-center mb-6">
            <button
              onClick={onOpenWorkflowManager}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Open Workflow Manager
            </button>
          </div>

          {/* Tips */}
          <div className="pt-4 border-t border-gray-200 dark:border-neutral-800">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-medium">
              Quick Tips
            </p>
            <div className="flex flex-wrap gap-2 justify-center text-xs text-gray-600 dark:text-gray-400">
              <span className="bg-gray-100 dark:bg-neutral-800 px-2 py-1 rounded">
                Ctrl+Scroll to zoom
              </span>
              <span className="bg-gray-100 dark:bg-neutral-800 px-2 py-1 rounded">
                Click nodes to edit
              </span>
              <span className="bg-gray-100 dark:bg-neutral-800 px-2 py-1 rounded">
                Drag handles to connect
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
