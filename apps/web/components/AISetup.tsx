"use client";

import { useState } from "react";
import { Check, ExternalLink, Loader2, Trash2 } from "lucide-react";
import {
  AIConfigRequest,
  AIStatus,
  forgetAIConfig,
  saveAIConfig,
  testAIConfig,
} from "../lib/ai";
import { errorMessage } from "../lib/api";

/**
 * Choosing which model the assistant talks to, while k8n is running.
 *
 * The key goes to the k8n process — the one on your machine, reading your
 * kubeconfig — and is written to a file there. It never comes back: this form
 * only ever learns that a key exists and what its first and last few characters
 * are. That is what makes the hosted page safe to use with a local engine.
 *
 * Model names change faster than anything else here, so the defaults are a
 * starting point and Test is the arbiter.
 */
export default function AISetup({
  status,
  onChanged,
}: {
  status: AIStatus;
  onChanged: (next: AIStatus) => void;
}) {
  const providers = status.providers ?? [];
  const [provider, setProvider] = useState(status.provider || providers[0]?.id || "google");
  const [model, setModel] = useState(status.model || "");
  const [baseUrl, setBaseUrl] = useState(status.baseUrl || "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | "forget" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const chosen = providers.find(p => p.id === provider);
  const config: AIConfigRequest = { provider, model, baseUrl, apiKey };

  /** Switching provider carries its defaults across, but never the key. */
  const pick = (id: string) => {
    const next = providers.find(p => p.id === id);
    setProvider(id);
    setModel(next?.defaultModel ?? "");
    setBaseUrl(next?.baseUrl ?? "");
    setResult(null);
  };

  const run = async (
    what: "test" | "save" | "forget",
    action: () => Promise<{ ok?: boolean; reply?: string } | AIStatus>
  ) => {
    setBusy(what);
    setResult(null);
    try {
      const outcome = await action();
      if (what === "test") {
        const reply = (outcome as { reply?: string }).reply;
        setResult({ ok: true, message: reply ? `Answered: ${reply}` : "The provider answered." });
      } else {
        onChanged(outcome as AIStatus);
        setApiKey("");
        setResult({
          ok: true,
          message: what === "save" ? "Saved. The assistant is on." : "Key forgotten.",
        });
      }
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 p-4">
      <p className="text-xs leading-relaxed text-gray-400">
        The assistant reads your cluster through read-only tools and proposes changes you accept or
        reject. Point it at a model to switch it on.
      </p>

      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Provider
        </span>
        <select
          value={provider}
          onChange={e => pick(e.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
        >
          {providers.map(p => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {chosen?.note && (
        <p className="text-[10px] leading-relaxed text-gray-500">{chosen.note}</p>
      )}

      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Model
        </span>
        <input
          value={model}
          onChange={e => setModel(e.target.value)}
          placeholder="model id"
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 font-mono text-xs text-gray-100 placeholder:text-neutral-600 focus:border-blue-500 focus:outline-none"
        />
      </label>

      {/* Shown for every provider: a gateway, a proxy or a self-hosted server is
          the same thing with a different address. */}
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Endpoint
        </span>
        <input
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          placeholder={provider === "google" ? "Google's own SDK — no URL needed" : "https://…/v1"}
          disabled={provider === "google"}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 font-mono text-xs text-gray-100 placeholder:text-neutral-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
        />
      </label>

      <label className="block">
        <span className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          API key
          {chosen?.keysUrl && (
            <a
              href={chosen.keysUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 font-normal normal-case tracking-normal text-blue-400 hover:text-blue-300"
            >
              Get one
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </span>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={status.keyHint ? `${status.keyHint} — blank keeps it` : "paste your key"}
          autoComplete="off"
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 font-mono text-xs text-gray-100 placeholder:text-neutral-600 focus:border-blue-500 focus:outline-none"
        />
      </label>

      <p className="text-[10px] leading-relaxed text-gray-600">
        The key is stored by the k8n process on this machine, in{" "}
        <code className="font-mono">~/.k8n/config.json</code>. It is never sent to the page, and
        never leaves for anywhere but the provider you chose.
        {status.source === "env" && " The current one came from the environment, not from here."}
      </p>

      {result && (
        <p
          className={`rounded border px-2.5 py-2 text-[11px] leading-relaxed ${
            result.ok
              ? "border-green-900/50 bg-green-950/20 text-green-300"
              : "border-red-900/50 bg-red-950/20 text-red-300"
          }`}
        >
          {result.message}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => run("test", () => testAIConfig(config))}
          disabled={busy !== null}
          className="flex flex-1 items-center justify-center gap-1.5 rounded border border-neutral-700 px-3 py-2 text-xs text-gray-300 transition-colors hover:border-neutral-600 hover:text-gray-100 disabled:opacity-50"
        >
          {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Test
        </button>
        <button
          onClick={() => run("save", () => saveAIConfig(config))}
          disabled={busy !== null}
          className="flex flex-1 items-center justify-center gap-1.5 rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
        >
          {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </button>
      </div>

      {status.enabled && (
        <button
          onClick={() => run("forget", () => forgetAIConfig())}
          disabled={busy !== null}
          className="flex w-full items-center justify-center gap-1.5 rounded border border-red-900/50 px-3 py-2 text-[11px] text-red-300 transition-colors hover:border-red-800 hover:bg-red-950/30 disabled:opacity-50"
        >
          {busy === "forget" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Forget this key
        </button>
      )}
    </div>
  );
}
