"use client";

import { useEffect } from "react";
import { AlertTriangle, CheckCircle, Info, X } from "lucide-react";
import { useDialogs, ToastKind } from "../lib/dialog";

const TOAST_STYLES: Record<ToastKind, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: "border-blue-500/40 text-blue-200" },
  success: { icon: CheckCircle, className: "border-green-500/40 text-green-200" },
  error: { icon: AlertTriangle, className: "border-red-500/40 text-red-200" },
};

/**
 * Renders toasts and the confirm dialog. Mounted once in the root layout so any
 * module can call notify() / confirmAction() without wiring up props.
 */
export default function Dialogs() {
  const { toasts, confirm, dismissToast, answerConfirm } = useDialogs();

  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") answerConfirm(false);
      if (e.key === "Enter") answerConfirm(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, answerConfirm]);

  return (
    <>
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
        {toasts.map((toast) => {
          const { icon: Icon, className } = TOAST_STYLES[toast.kind];
          return (
            <div
              key={toast.id}
              className={`flex items-start gap-2 rounded border bg-neutral-900 px-3 py-2 text-sm shadow-lg ${className}`}
            >
              <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span className="flex-1 whitespace-pre-wrap break-words">{toast.message}</span>
              <button
                onClick={() => dismissToast(toast.id)}
                className="text-neutral-500 hover:text-neutral-300"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      {confirm && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
          onClick={() => answerConfirm(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-lg font-semibold text-gray-100">{confirm.title}</h2>
            <p className="mb-5 whitespace-pre-wrap text-sm text-gray-400">{confirm.message}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => answerConfirm(false)}
                className="rounded px-4 py-2 text-sm text-gray-300 hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                autoFocus
                onClick={() => answerConfirm(true)}
                className={`rounded px-4 py-2 text-sm text-white ${
                  confirm.danger ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
