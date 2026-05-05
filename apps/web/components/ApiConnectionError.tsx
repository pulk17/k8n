'use client';

import { AlertCircle, RefreshCw, Terminal } from 'lucide-react';
import { API_URL } from '../lib/api';

interface ApiConnectionErrorProps {
  error: string;
  onRetry?: () => void;
}

export default function ApiConnectionError({ error, onRetry }: ApiConnectionErrorProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-neutral-950 p-4">
      <div className="max-w-2xl w-full bg-white dark:bg-neutral-900 border border-red-200 dark:border-red-900/50 rounded-lg shadow-lg overflow-hidden">
        {/* Header */}
        <div className="bg-red-50 dark:bg-red-950/20 border-b border-red-200 dark:border-red-900/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
            <h2 className="text-xl font-bold text-red-900 dark:text-red-300">
              API Connection Error
            </h2>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Error Message */}
          <div className="bg-red-50 dark:bg-red-950/10 border border-red-200 dark:border-red-900/30 rounded p-4">
            <p className="text-sm text-red-800 dark:text-red-300 font-medium mb-2">
              Error Details:
            </p>
            <p className="text-sm text-red-700 dark:text-red-400 font-mono">
              {error}
            </p>
          </div>

          {/* API URL */}
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Attempting to connect to:
            </p>
            <code className="block bg-gray-100 dark:bg-neutral-800 text-gray-900 dark:text-gray-100 px-3 py-2 rounded font-mono text-sm">
              {API_URL}
            </code>
          </div>

          {/* Instructions */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Terminal className="w-5 h-5" />
              How to Fix
            </h3>

            <div className="space-y-3">
              <div className="bg-gray-50 dark:bg-neutral-800 rounded p-4">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                  1. Start the API server
                </p>
                <code className="block bg-gray-900 text-green-400 px-3 py-2 rounded font-mono text-sm">
                  cd apps/api && go run main.go
                </code>
              </div>

              <div className="bg-gray-50 dark:bg-neutral-800 rounded p-4">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                  2. Verify the server is running
                </p>
                <code className="block bg-gray-900 text-green-400 px-3 py-2 rounded font-mono text-sm">
                  curl {API_URL}/health
                </code>
              </div>

              <div className="bg-gray-50 dark:bg-neutral-800 rounded p-4">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                  3. Check your environment variables
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                  Create a <code className="bg-gray-200 dark:bg-neutral-700 px-1 rounded">.env.local</code> file in <code className="bg-gray-200 dark:bg-neutral-700 px-1 rounded">apps/web/</code>:
                </p>
                <code className="block bg-gray-900 text-green-400 px-3 py-2 rounded font-mono text-sm">
                  NEXT_PUBLIC_API_URL=http://localhost:8080
                </code>
              </div>
            </div>
          </div>

          {/* Common Issues */}
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/30 rounded p-4">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-300 mb-2">
              💡 Common Issues:
            </p>
            <ul className="text-sm text-blue-800 dark:text-blue-400 space-y-1 list-disc list-inside">
              <li>API server not started</li>
              <li>Wrong port (should be 8080)</li>
              <li>Firewall blocking connection</li>
              <li>CORS issues (check browser console)</li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors font-medium"
              >
                <RefreshCw className="w-4 h-4" />
                Retry Connection
              </button>
            )}
            <a
              href="/connect"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors font-medium"
            >
              Go to Connect Page
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
