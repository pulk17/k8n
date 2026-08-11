'use client';

import { useEffect, useState } from "react";
import { Code2, Database, Server, Wifi, WifiOff, ChevronDown, ChevronUp, X } from "lucide-react";
import { API_URL } from "../lib/api";

export default function DevModeIndicator() {
  const [apiStatus, setApiStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [dbStatus, setDbStatus] = useState<'connected' | 'disconnected' | 'unknown'>('unknown');
  const [k8sStatus, setK8sStatus] = useState<'connected' | 'disconnected' | 'unknown'>('unknown');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(true);


  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch(`${API_URL}/health`);
        if (res.ok) {
          const data = await res.json();
          setApiStatus('connected');
          setDbStatus(data.database === 'connected' ? 'connected' : data.database === 'disconnected' ? 'disconnected' : 'unknown');
          setK8sStatus(data.kubernetes === 'connected' ? 'connected' : data.kubernetes === 'disconnected' ? 'disconnected' : 'unknown');
        } else {
          setApiStatus('disconnected');
          setDbStatus('unknown');
          setK8sStatus('unknown');
        }
      } catch {
        setApiStatus('disconnected');
        setDbStatus('unknown');
        setK8sStatus('unknown');
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, []);

  // Only show in development
  if (process.env.NODE_ENV === 'production' || !isVisible) {
    return null;
  }

  // Compact view when collapsed
  if (!isExpanded) {
    const allConnected = apiStatus === 'connected' && dbStatus === 'connected' && k8sStatus === 'connected';
    const hasIssues = apiStatus === 'disconnected' || dbStatus === 'disconnected' || k8sStatus === 'disconnected';

    return (
      <div className="fixed bottom-36 right-4 z-50">
        <button
          onClick={() => setIsExpanded(true)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg backdrop-blur-md transition-all ${
            allConnected 
              ? 'bg-green-600/90 hover:bg-green-700/90' 
              : hasIssues 
              ? 'bg-red-600/90 hover:bg-red-700/90' 
              : 'bg-yellow-600/90 hover:bg-yellow-700/90'
          } text-white`}
        >
          <Code2 className="w-4 h-4" />
          <span className="text-xs font-bold">DEV</span>
          <ChevronUp className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // Expanded view
  return (
    <div className="fixed bottom-36 right-4 z-50 bg-black/90 backdrop-blur-md text-white rounded-xl shadow-2xl border border-gray-700 overflow-hidden">
      <div className="bg-purple-600 px-3 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4" />
          <span className="text-xs font-bold">DEV MODE</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(false)}
            className="text-white/80 hover:text-white transition-colors p-1"
            title="Minimize"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
          <button
            onClick={() => setIsVisible(false)}
            className="text-white/80 hover:text-white transition-colors p-1"
            title="Close (refresh to show again)"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
      
      <div className="p-3 space-y-2">
        <StatusRow 
          icon={<Server className="w-4 h-4" />}
          label="API"
          status={apiStatus}
        />
        <StatusRow 
          icon={<Database className="w-4 h-4" />}
          label="Database"
          status={dbStatus}
        />
        <StatusRow 
          icon={apiStatus === 'connected' ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
          label="K8s Cluster"
          status={k8sStatus}
        />
      </div>

      <div className="px-3 py-2 bg-black/50 border-t border-gray-700">
        <div className="text-[10px] text-gray-400 space-y-0.5">
          <div>API: {API_URL}</div>
          <div>Node: {process.env.NODE_ENV}</div>
        </div>
        {(apiStatus === 'disconnected' || k8sStatus === 'disconnected') && (
          <a
            href="/connect"
            className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-semibold rounded transition-colors"
          >
            <Wifi className="w-3 h-3" />
            Connect to Cluster
          </a>
        )}
      </div>
    </div>
  );
}

function StatusRow({ 
  icon, 
  label, 
  status 
}: { 
  icon: React.ReactNode; 
  label: string; 
  status: 'connected' | 'disconnected' | 'checking' | 'unknown';
}) {
  const statusColors = {
    connected: 'bg-green-500',
    disconnected: 'bg-red-500',
    checking: 'bg-yellow-500 animate-pulse',
    unknown: 'bg-gray-500',
  };

  const statusText = {
    connected: 'Connected',
    disconnected: 'Disconnected',
    checking: 'Checking...',
    unknown: 'Unknown',
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <div className="text-gray-400">{icon}</div>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
        <span className="text-[10px] text-gray-400">{statusText[status]}</span>
      </div>
    </div>
  );
}
