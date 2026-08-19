"use client";

import { FieldSpec } from "../lib/nodeSchema";
import { FieldValue } from "../lib/graph";

// Lifted out of K8sNode, which used to render the whole edit form inside the
// node card. The form now lives in the inspector, but the widget that renders
// one FieldSpec is the same either way, so it belongs on its own.

const inputClass =
  "w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-gray-100 " +
  "transition-colors placeholder:text-neutral-600 hover:border-neutral-600 " +
  "focus:border-blue-500 focus:outline-none";

export default function FieldInput({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
}) {
  // Every input is labelled by id rather than by wrapping, so a screen reader
  // announces the hint text too — the hints are where most of the Kubernetes
  // explanation in the form actually lives.
  const id = `field-${spec.key}`;
  const hintId = spec.hint ? `${id}-hint` : undefined;

  const hint = spec.hint ? (
    <p id={hintId} className="mt-1 text-[10px] leading-snug text-gray-500">
      {spec.hint}
    </p>
  ) : null;

  if (spec.type === "checkbox") {
    return (
      <div>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={e => onChange(e.target.checked)}
            aria-describedby={hintId}
            className="h-3.5 w-3.5 accent-blue-500"
          />
          <span className="text-xs font-medium text-gray-300">{spec.label}</span>
        </label>
        {hint}
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-gray-400">
        {spec.label}
      </label>

      {spec.type === "select" ? (
        <select
          id={id}
          value={String(value ?? spec.options?.[0] ?? "")}
          onChange={e => onChange(e.target.value)}
          aria-describedby={hintId}
          className={inputClass}
        >
          {spec.options?.map(opt => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : spec.type === "textarea" ? (
        <textarea
          id={id}
          value={String(value ?? "")}
          onChange={e => onChange(e.target.value)}
          placeholder={spec.placeholder}
          rows={spec.rows ?? 3}
          aria-describedby={hintId}
          className={`${inputClass} font-mono`}
        />
      ) : spec.type === "number" ? (
        <input
          id={id}
          type="number"
          min={spec.min}
          max={spec.max}
          value={value === undefined ? "" : String(value)}
          onChange={e => {
            const raw = e.target.value;
            onChange(raw === "" ? undefined : Number(raw));
          }}
          placeholder={spec.placeholder}
          aria-describedby={hintId}
          className={inputClass}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={String(value ?? "")}
          onChange={e => onChange(e.target.value)}
          placeholder={spec.placeholder}
          aria-describedby={hintId}
          className={inputClass}
        />
      )}

      {hint}
    </div>
  );
}
