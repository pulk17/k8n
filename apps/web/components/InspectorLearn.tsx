"use client";

import { useState } from "react";
import { AlertTriangle, BookOpen, Check, Copy, ExternalLink, Lightbulb, Terminal } from "lucide-react";
import { conceptFor, kubectlFor } from "../lib/concepts";
import { inputsFor, outputsFor } from "../lib/connections";
import { RESOURCE_COLORS, DEFAULT_RESOURCE_COLOR } from "../lib/constants";

/**
 * What this kind of object *is*, for someone who has not memorised Kubernetes.
 *
 * The order is deliberate and is the order you would explain it out loud: an
 * image to hang it on, then what it actually does, then the one sentence worth
 * remembering, then what it wires up to, then the ways people get it wrong, and
 * finally the kubectl you would type — which is the bit that connects the
 * canvas back to the tool everyone else is using.
 */
export default function InspectorLearn({
  kind,
  name,
  namespace,
}: {
  kind: string;
  name: string;
  namespace: string;
}) {
  const concept = conceptFor(kind);
  const inputs = inputsFor(kind);
  const outputs = outputsFor(kind);

  if (!concept) {
    return (
      <div className="p-4">
        <p className="text-xs leading-relaxed text-gray-400">
          <span className="font-medium text-gray-300">{kind}</span> is a custom resource, so k8n has
          no built-in explanation for it. Whoever installed its CRD decides what it means — the
          operator&apos;s own documentation is the place to look.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4">
      <section>
        <p className="text-sm leading-relaxed text-gray-200">{concept.analogy}</p>
      </section>

      <Section icon={BookOpen} title="What it does">
        <p className="text-xs leading-relaxed text-gray-400">{concept.whatItDoes}</p>
      </Section>

      <div className="rounded-md border border-blue-900/50 bg-blue-950/30 p-3">
        <div className="mb-1 flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5 text-blue-400" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-400">
            The key idea
          </span>
        </div>
        <p className="text-xs leading-relaxed text-blue-100">{concept.keyIdea}</p>
      </div>

      {(inputs.length > 0 || outputs.length > 0) && (
        <Section title="How it wires up">
          <div className="space-y-1.5">
            {outputs.map(spec => (
              <Wire key={`out-${spec.type}`} spec={spec} direction="out" />
            ))}
            {inputs.map(spec => (
              <Wire key={`in-${spec.type}`} spec={spec} direction="in" />
            ))}
          </div>
        </Section>
      )}

      <Section icon={AlertTriangle} title="Where people trip up" tone="warn">
        <ul className="space-y-2">
          {concept.gotchas.map(gotcha => (
            <li key={gotcha} className="flex gap-2 text-xs leading-relaxed text-gray-400">
              <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-yellow-600" />
              <span>{gotcha}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section icon={Terminal} title="The same thing in kubectl">
        <div className="space-y-1.5">
          {concept.kubectl.map(command => (
            <CommandRow key={command} command={kubectlFor(command, name, namespace)} />
          ))}
        </div>
      </Section>

      <a
        href={concept.docs}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 text-[11px] font-medium text-blue-400 transition-colors hover:text-blue-300"
      >
        Kubernetes documentation for {kind}
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

/** One connection this kind can make, coloured to match the socket on the node. */
function Wire({
  spec,
  direction,
}: {
  spec: { type: string; color: string; label: string; kinds: string[] };
  direction: "in" | "out";
}) {
  return (
    <div className="flex items-start gap-2 rounded border border-neutral-800 bg-neutral-800/40 px-2 py-1.5">
      <span
        className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-sm"
        style={{ backgroundColor: spec.color }}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-gray-300">
          {spec.label}{" "}
          <span className="font-normal text-gray-500">
            ({direction === "out" ? "right socket" : "left socket"})
          </span>
        </p>
        <p className="mt-0.5 text-[10px] leading-snug text-gray-500">
          {spec.kinds.map((k, i) => (
            <span key={k}>
              {i > 0 && ", "}
              <span style={{ color: RESOURCE_COLORS[k] || DEFAULT_RESOURCE_COLOR }}>{k}</span>
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

/** A copyable command. Copying is the point — these are meant to be run. */
function CommandRow({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(command).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      // Clipboard access is denied outside a secure context. Saying nothing is
      // better than an error toast for something the user can still select.
      () => {}
    );
  };

  return (
    <button
      onClick={copy}
      title="Copy"
      className="group flex w-full items-center gap-2 rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-left transition-colors hover:border-neutral-700"
    >
      <code className="min-w-0 flex-1 break-all font-mono text-[10px] leading-relaxed text-gray-300">
        {command}
      </code>
      {copied ? (
        <Check className="h-3 w-3 flex-shrink-0 text-green-400" />
      ) : (
        <Copy className="h-3 w-3 flex-shrink-0 text-gray-600 transition-colors group-hover:text-gray-400" />
      )}
    </button>
  );
}

function Section({
  icon: Icon,
  title,
  tone,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  tone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {Icon && (
          <Icon className={`h-3 w-3 ${tone === "warn" ? "text-yellow-600" : "text-gray-600"}`} />
        )}
        {title}
      </h4>
      {children}
    </section>
  );
}
