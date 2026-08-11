'use client';

import { useCallback, useEffect, useState } from "react";
import { Package, RefreshCw, Trash2, History, ArrowUpCircle, ArrowDownCircle, X, CheckCircle, AlertCircle, Clock } from "lucide-react";
import {
  HelmRelease,
  errorMessage,
  fetchHelmHistory,
  fetchHelmReleases,
  rollbackHelmRelease,
  uninstallHelmRelease,
  upgradeHelmRelease,
} from "../lib/api";
import { confirmAction, notify, notifyError } from "../lib/dialog";

export default function HelmReleaseManager() {
  const [releases, setReleases] = useState<HelmRelease[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState<HelmRelease | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HelmRelease[]>([]);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeValues, setUpgradeValues] = useState("");

  const loadReleases = useCallback(async () => {
    setLoading(true);
    try {
      setReleases(await fetchHelmReleases());
    } catch (err) {
      notifyError(`Failed to load Helm releases: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadReleases();
  }, [open, loadReleases]);

  const loadHistory = async (release: HelmRelease) => {
    try {
      setHistory(await fetchHelmHistory(release.name, release.namespace));
      setShowHistory(true);
    } catch (err) {
      notifyError(`Failed to load history: ${errorMessage(err)}`);
    }
  };

  const uninstall = async (release: HelmRelease) => {
    const ok = await confirmAction({
      title: "Uninstall release",
      message: `${release.name} in namespace "${release.namespace}" and everything it installed.`,
      confirmLabel: "Uninstall",
      danger: true,
    });
    if (!ok) return;

    try {
      await uninstallHelmRelease(release.name, release.namespace);
      notify(`Uninstalled ${release.name}`, "success");
      loadReleases();
    } catch (err) {
      notifyError(`Failed to uninstall: ${errorMessage(err)}`);
    }
  };

  const upgrade = async (release: HelmRelease) => {
    try {
      const { revision } = await upgradeHelmRelease(release, upgradeValues);
      notify(`Upgraded ${release.name} to revision ${revision}`, "success");
      setShowUpgrade(false);
      setUpgradeValues("");
      loadReleases();
    } catch (err) {
      notifyError(`Failed to upgrade: ${errorMessage(err)}`);
    }
  };

  const rollback = async (release: HelmRelease, revision: number) => {
    const ok = await confirmAction({
      title: "Roll back release",
      message: `${release.name} will be rolled back to revision ${revision}.`,
      confirmLabel: "Roll back",
    });
    if (!ok) return;

    try {
      await rollbackHelmRelease(release.name, release.namespace, revision);
      notify(`Rolled back ${release.name} to revision ${revision}`, "success");
      setShowHistory(false);
      loadReleases();
    } catch (err) {
      notifyError(`Failed to roll back: ${errorMessage(err)}`);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'deployed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'pending-install':
      case 'pending-upgrade':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-500" />;
    }
  };

  if (!open) {
    return (
      <button 
        onClick={() => setOpen(true)}
        className="absolute bottom-4 left-[412px] z-10 flex items-center gap-2 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-gray-300 transition-colors hover:bg-neutral-800"
        title="Manage Helm Releases"
      >
        <Package className="h-4 w-4" />
        <span className="text-xs font-medium">Releases</span>
      </button>
    );
  }

  return (
    <>
      <div className="absolute bottom-16 left-[292px] z-20 w-[600px] bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 shadow-lg rounded overflow-hidden max-h-[70vh] flex flex-col">
        <div className="bg-gray-50 dark:bg-neutral-800 border-b border-gray-200 dark:border-neutral-700 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Helm Releases</h2>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={loadReleases}
              disabled={loading}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button 
              onClick={() => setOpen(false)} 
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 custom-scrollbar">
          {loading && releases.length === 0 ? (
            <div className="text-center text-sm text-gray-500 py-8 italic">Loading releases...</div>
          ) : releases.length === 0 ? (
            <div className="text-center text-sm text-gray-500 py-8">
              <p className="mb-2">No Helm releases found</p>
              <p className="text-xs text-gray-400">Install charts from the Helm Charts panel</p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {releases.map((release) => (
                <div 
                  key={`${release.namespace}-${release.name}`}
                  className="border border-gray-200 dark:border-neutral-800 rounded p-3 bg-white dark:bg-neutral-900 hover:border-orange-300 dark:hover:border-orange-700 transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusIcon(release.status)}
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {release.name}
                        </h3>
                        <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded">
                          {release.namespace}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {release.chart} v{release.chartVersion}
                      </p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-500 mt-1">
                        Revision {release.revision} • Updated {release.updated}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          setSelectedRelease(release);
                          setShowUpgrade(true);
                        }}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                        title="Upgrade"
                      >
                        <ArrowUpCircle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setSelectedRelease(release);
                          loadHistory(release);
                        }}
                        className="p-1.5 text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 rounded transition-colors"
                        title="History"
                      >
                        <History className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => uninstall(release)}
                        className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                        title="Uninstall"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {release.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">
                      {release.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* History Modal */}
      {showHistory && selectedRelease && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-neutral-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Release History: {selectedRelease.name}
              </h3>
              <button onClick={() => setShowHistory(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              {history.map((rev) => (
                <div key={rev.revision} className="border border-gray-200 dark:border-neutral-800 rounded p-3 mb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusIcon(rev.status)}
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          Revision {rev.revision}
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded">
                          {rev.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400">{rev.chart}</p>
                      <p className="text-[10px] text-gray-500 mt-1">{rev.updated}</p>
                      {rev.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic">{rev.description}</p>
                      )}
                    </div>
                    {rev.revision !== selectedRelease.revision && (
                      <button
                        onClick={() => rollback(selectedRelease, rev.revision)}
                        className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                      >
                        <ArrowDownCircle className="w-3 h-3" />
                        Rollback
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Upgrade Modal */}
      {showUpgrade && selectedRelease && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-xl max-w-2xl w-full">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-neutral-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Upgrade: {selectedRelease.name}
              </h3>
              <button onClick={() => { setShowUpgrade(false); setUpgradeValues(""); }} className="text-gray-500 hover:text-gray-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                Custom Values (YAML)
              </label>
              <textarea
                value={upgradeValues}
                onChange={(e) => setUpgradeValues(e.target.value)}
                placeholder="replicaCount: 5&#10;service:&#10;  type: LoadBalancer"
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-neutral-700 rounded bg-white dark:bg-neutral-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                rows={8}
              />
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => { setShowUpgrade(false); setUpgradeValues(""); }}
                  className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => upgrade(selectedRelease)}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center gap-2"
                >
                  <ArrowUpCircle className="w-4 h-4" />
                  Upgrade
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
