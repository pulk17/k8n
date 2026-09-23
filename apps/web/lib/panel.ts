import { useEffect, useState } from "react";

const EVENT = "k8n:panel";

/**
 * Open or closed, for one of the floating panels on the canvas. They share a
 * corner, so opening one closes the others — Helm Charts and Releases used to
 * pile up on top of each other — and Escape closes whichever is open.
 */
export function usePanel(name: string) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== name) setOpen(false);
    };
    window.addEventListener(EVENT, onOther);
    return () => window.removeEventListener(EVENT, onOther);
  }, [name]);

  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent(EVENT, { detail: name }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, name]);

  return [open, setOpen] as const;
}
