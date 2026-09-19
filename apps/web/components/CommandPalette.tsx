"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

export interface Command {
  label: string;
  hint?: string;
  run: () => void;
}

/** Commands whose label or hint contains every typed word, in order given. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter(c => {
    const text = `${c.label} ${c.hint ?? ""}`.toLowerCase();
    return words.every(w => text.includes(w));
  });
}

/**
 * Ctrl+K: every action on the canvas by name, so nothing needs hunting for in
 * a toolbar or a menu.
 */
export default function CommandPalette({ commands }: { commands: Command[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(o => !o);
        setQuery("");
        setActive(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  const shown = filterCommands(commands, query).slice(0, 12);
  const choose = (c?: Command) => {
    if (!c) return;
    setOpen(false);
    c.run();
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/50 pt-[15vh]"
      onMouseDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-neutral-800 px-3">
          <Search className="h-4 w-4 text-gray-500" />
          <input
            autoFocus
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={e => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "ArrowDown") setActive(a => Math.min(a + 1, shown.length - 1));
              if (e.key === "ArrowUp") setActive(a => Math.max(a - 1, 0));
              if (e.key === "Enter") choose(shown[active]);
            }}
            placeholder="Type a command — add deployment, apply, tour…"
            aria-label="Command"
            className="w-full bg-transparent py-3 text-sm text-gray-100 outline-none placeholder:text-gray-600"
          />
        </div>
        <ul role="listbox" className="max-h-80 overflow-y-auto py-1">
          {shown.length === 0 && <li className="px-3 py-2 text-xs text-gray-500">Nothing matches.</li>}
          {shown.map((c, i) => (
            <li
              key={c.label}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(c)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm ${
                i === active ? "bg-blue-950/60 text-gray-100" : "text-gray-300"
              }`}
            >
              {c.label}
              {c.hint && <span className="truncate text-[11px] text-gray-500">{c.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
