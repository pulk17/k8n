"use client";

import { ArrowLeft, Box, Globe, FileCode, Lock, Network, Zap, GitBranch } from "lucide-react";
import Link from "next/link";

export default function HelpPage() {
  return (
    <div className="h-screen bg-gray-50 dark:bg-neutral-950 overflow-y-scroll" style={{ scrollbarWidth: 'thin', scrollbarColor: '#4b5563 #1f2937' }}>
      <div className="max-w-4xl mx-auto p-8 pb-24">
        {/* Header */}
        <div className="mb-8">
          <Link 
            href="/canvas" 
            className="inline-flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Canvas
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            k8n User Guide
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Learn how to use k8n to visually design and deploy Kubernetes workloads
          </p>
        </div>

        {/* Quick Start */}
        <section className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800 p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Quick Start</h2>
          <ol className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
              <div>
                <strong>Connect to your cluster:</strong> Go to the connect page and select your kubectl context
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
              <div>
                <strong>Add resources:</strong> Drag resources from the left toolbox onto the canvas
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">3</span>
              <div>
                <strong>Configure nodes:</strong> Click on a node header to expand and edit its properties
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">4</span>
              <div>
                <strong>Connect resources:</strong> Drag from colored handles to create relationships
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">5</span>
              <div>
                <strong>Deploy:</strong> Click "Apply" in the toolbar to deploy to your cluster
              </div>
            </li>
          </ol>
        </section>

        {/* Connection Types */}
        <section className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800 p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            <GitBranch className="w-5 h-5 inline mr-2" />
            Connection Types (ComfyUI-Style)
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            k8n uses typed connections - you can only connect compatible resources. Hover over connection handles to see what they accept.
          </p>
          
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded-sm mt-1" style={{ backgroundColor: '#22c55e' }}></div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Network (Green)</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Service → Deployment/StatefulSet/Pod - Routes traffic to workloads
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded-sm mt-1" style={{ backgroundColor: '#eab308' }}></div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Config (Yellow)</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  ConfigMap/Secret → Deployment/StatefulSet/DaemonSet/Pod - Provides configuration
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded-sm mt-1" style={{ backgroundColor: '#ec4899' }}></div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Routing (Pink)</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Ingress → Service - Exposes services externally
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Resource Types */}
        <section className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800 p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Resource Types</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded border border-blue-200 dark:border-blue-800">
              <Box className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Deployment</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Manages a replicated set of Pods. Configure replicas and container image.
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3 p-3 bg-green-50 dark:bg-green-950/20 rounded border border-green-200 dark:border-green-800">
              <Globe className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Service</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Exposes Pods as a network service. Configure port and connect to Deployments.
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3 p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded border border-yellow-200 dark:border-yellow-800">
              <FileCode className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">ConfigMap</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Stores configuration data. Connect to workloads to inject config.
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-950/20 rounded border border-red-200 dark:border-red-800">
              <Lock className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Secret</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Stores sensitive data. Connect to workloads to inject secrets.
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3 p-3 bg-pink-50 dark:bg-pink-950/20 rounded border border-pink-200 dark:border-pink-800">
              <Network className="w-5 h-5 text-pink-600 dark:text-pink-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Ingress</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Exposes HTTP/HTTPS routes. Connect to Services to route external traffic.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Status Indicators */}
        <section className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800 p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Status Indicators</h2>
          
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <div>
                <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">Running/Ready/Active:</span>
                <span className="text-sm text-gray-600 dark:text-gray-400 ml-2">Resource is healthy and operational</span>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <div>
                <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">Pending/NotReady:</span>
                <span className="text-sm text-gray-600 dark:text-gray-400 ml-2">Resource is starting or waiting</span>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <div>
                <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">Failed/Error:</span>
                <span className="text-sm text-gray-600 dark:text-gray-400 ml-2">Resource has errors or crashed</span>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-gray-400"></div>
              <div>
                <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">Unknown:</span>
                <span className="text-sm text-gray-600 dark:text-gray-400 ml-2">Status cannot be determined</span>
              </div>
            </div>
          </div>
        </section>

        {/* Keyboard Shortcuts */}
        <section className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800 p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            <Zap className="w-5 h-5 inline mr-2" />
            Keyboard Shortcuts
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
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
              <span className="text-gray-700 dark:text-gray-300">Show Help</span>
              <kbd className="px-2 py-1 bg-gray-200 dark:bg-neutral-700 rounded text-xs font-mono">?</kbd>
            </div>
          </div>
        </section>

        {/* Verifying Deployments */}
        <section className="bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800 p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Verifying Deployments</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            After clicking "Apply", use these kubectl commands to verify your resources:
          </p>
          
          <div className="space-y-3">
            <div className="bg-neutral-900 rounded p-3">
              <code className="text-xs text-green-400 font-mono">kubectl get all -n default</code>
              <p className="text-xs text-gray-400 mt-1">View all resources in the namespace</p>
            </div>
            
            <div className="bg-neutral-900 rounded p-3">
              <code className="text-xs text-green-400 font-mono">kubectl get pods -n default --watch</code>
              <p className="text-xs text-gray-400 mt-1">Watch pods in real-time</p>
            </div>
            
            <div className="bg-neutral-900 rounded p-3">
              <code className="text-xs text-green-400 font-mono">kubectl describe deployment &lt;name&gt; -n default</code>
              <p className="text-xs text-gray-400 mt-1">Get detailed information about a deployment</p>
            </div>
            
            <div className="bg-neutral-900 rounded p-3">
              <code className="text-xs text-green-400 font-mono">kubectl logs deployment/&lt;name&gt; -n default</code>
              <p className="text-xs text-gray-400 mt-1">View logs from a deployment</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
