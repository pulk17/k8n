import { create } from "zustand";

// Replaces window.alert / window.confirm. Those block the whole tab, can't be
// styled, and are suppressed outright in some embedded browsers — which meant a
// failed delete could silently look like nothing happened.

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (confirmed: boolean) => void;
}

interface DialogState {
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  dismissToast: (id: number) => void;
  answerConfirm: (confirmed: boolean) => void;
}

export const useDialogs = create<DialogState>((set, get) => ({
  toasts: [],
  confirm: null,

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  answerConfirm: (confirmed) => {
    const pending = get().confirm;
    set({ confirm: null });
    pending?.resolve(confirmed);
  },
}));

let nextToastId = 1;

/** Shows a transient message. Errors stay up longer than successes. */
export function notify(message: string, kind: ToastKind = "info") {
  const id = nextToastId++;
  useDialogs.setState((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
  setTimeout(() => useDialogs.getState().dismissToast(id), kind === "error" ? 8000 : 4000);
}

export const notifyError = (message: string) => notify(message, "error");

/** Resolves true if the user confirms. Only one dialog is open at a time. */
export function confirmAction(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  // A second request while one is open would strand the first promise, so
  // resolve it as declined before taking over.
  useDialogs.getState().answerConfirm(false);

  return new Promise((resolve) => {
    useDialogs.setState({
      confirm: {
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? "Confirm",
        danger: options.danger ?? false,
        resolve,
      },
    });
  });
}
