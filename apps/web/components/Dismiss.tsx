"use client";

import { useSyncExternalStore } from "react";
import { X } from "lucide-react";

/**
 * Notices you can close, remembered in this browser, so one that has been read
 * once does not come back on every page and every reload. Read through
 * useSyncExternalStore: the static render has no storage, and this way the
 * page does not flash the notice before hiding it.
 */
const PREFIX = "k8n_dismissed:";
const EVENT = "k8n:dismissed";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function isDismissed(key: string): boolean {
  try {
    return localStorage.getItem(PREFIX + key) === "1";
  } catch {
    return false;
  }
}

/** [dismissed, dismiss] for a notice identified by `key`. */
export function useDismissed(key: string): [boolean, () => void] {
  const dismissed = useSyncExternalStore(subscribe, () => isDismissed(key), () => false);
  const dismiss = () => {
    try {
      localStorage.setItem(PREFIX + key, "1");
    } catch {
      // Blocked storage: it stays closed until the page reloads.
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [dismissed, dismiss];
}

/** Brings every dismissed notice back — for the Help page. */
export function resetDismissed(): void {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith(PREFIX))
      .forEach(k => localStorage.removeItem(k));
  } catch {
    // Nothing to reset.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function DismissButton({ onClick, label = "Dismiss", className = "" }: { onClick: () => void; label?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex-shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:bg-white/10 hover:opacity-100 ${className}`}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}
