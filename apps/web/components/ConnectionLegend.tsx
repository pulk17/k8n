"use client";

import { CONNECTION_TYPES } from "../lib/constants";

// The sockets on a node are colour-coded by what the connection does. Without
// this the colours are just decoration.
const SHOWN = ["network", "routing", "config", "storage", "scaling", "security"] as const;

export default function ConnectionLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {SHOWN.map(type => (
        <span key={type} className="flex items-center gap-1.5 text-[10px] text-gray-400">
          <span
            className="h-2 w-2 rounded-sm"
            style={{ backgroundColor: CONNECTION_TYPES[type].color }}
          />
          {CONNECTION_TYPES[type].label}
        </span>
      ))}
    </div>
  );
}
