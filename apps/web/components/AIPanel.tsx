'use client';

import { useEffect, useRef, useState } from "react";
import {
  Sparkles, X, Send, Loader2, Wrench, Check, Ban, AlertCircle, BookOpen, Stethoscope,
} from "lucide-react";
import { useCanvasStore, GraphPatch } from "../store/canvasStore";
import { streamChat, fetchAIStatus, ChatTurn, explainNode } from "../lib/ai";
import { errorMessage } from "../lib/api";

interface Message {
  role: "user" | "model";
  text: string;
  /** Tool calls made while producing this answer, shown as a trace. */
  tools?: { name: string; detail?: string }[];
  patch?: GraphPatch;
  patchState?: "pending" | "accepted" | "rejected";
  error?: string;
}

/**
 * The assistant panel.
 *
 * It proposes; it never applies. Graph patches land on the canvas only when the
 * user accepts, and nothing reaches the cluster without going through the normal
 * preview and apply flow.
 */
export default function AIPanel() {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { nodes, edges, activeNamespace, selectedNodeId, applyGraphPatch } = useCanvasStore();

  useEffect(() => {
    fetchAIStatus().then(s => setEnabled(s.enabled));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // Nothing renders at all without a configured key, so the rest of k8n is
  // unchanged for anyone not using the assistant.
  if (!enabled) return null;

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;

    const history: ChatTurn[] = messages
      .filter(m => !m.error)
      .map(m => ({ role: m.role, text: m.text }));

    setMessages(prev => [...prev, { role: "user", text: question }, { role: "model", text: "", tools: [] }]);
    setInput("");
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const update = (fn: (m: Message) => Message) =>
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = fn(next[next.length - 1]);
        return next;
      });

    try {
      await streamChat(
        {
          message: question,
          history,
          graph: { nodes, edges },
          namespace: activeNamespace,
        },
        event => {
          if (event.type === "text" && event.text) {
            update(m => ({ ...m, text: m.text + event.text }));
          } else if (event.type === "tool") {
            update(m => ({
              ...m,
              tools: [...(m.tools || []), { name: event.tool || "tool", detail: event.detail }],
            }));
          } else if (event.type === "patch" && event.patch) {
            update(m => ({ ...m, patch: event.patch, patchState: "pending" }));
          } else if (event.type === "error") {
            update(m => ({ ...m, error: event.message || "Something went wrong." }));
          }
        },
        controller.signal
      );
    } catch (err) {
      // Aborting is how we cancel a turn, not a failure worth reporting.
      if (!(err instanceof Error) || err.name !== "AbortError") {
        update(m => ({ ...m, error: errorMessage(err) }));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  /**
   * Explains one node. This is a single request rather than a streamed turn,
   * so it lands in the transcript as a finished answer.
   */
  const explainSelected = async () => {
    const node = nodes.find(n => n.id === selectedNodeId);
    if (!node || busy) return;

    const question = `Explain ${node.data.kind} "${node.data.name}".`;
    setMessages(prev => [...prev, { role: "user", text: question }, { role: "model", text: "" }]);
    setBusy(true);
    try {
      const result = await explainNode({ nodes, edges }, node.id);
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: "model", text: result?.explanation || "No explanation came back." };
        return next;
      });
    } catch (err) {
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: "model", text: "", error: errorMessage(err) };
        return next;
      });
    } finally {
      setBusy(false);
    }
  };

  const decide = (index: number, accept: boolean) => {
    setMessages(prev => {
      const next = [...prev];
      const msg = next[index];
      if (!msg?.patch) return prev;

      if (accept) {
        const result = applyGraphPatch(msg.patch);
        next[index] = {
          ...msg,
          patchState: "accepted",
          text:
            msg.text +
            `\n\nApplied to the canvas: ${result.added} added, ${result.connected} connected, ${result.updated} updated. Press Ctrl+Z to undo.`,
        };
      } else {
        next[index] = { ...msg, patchState: "rejected" };
      }
      return next;
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute bottom-4 right-16 z-30 px-3 py-2 bg-neutral-900/90 hover:bg-neutral-800 backdrop-blur-md border border-neutral-700 rounded-lg shadow-lg flex items-center gap-2 text-sm text-gray-200 transition-colors"
        title="Ask the k8n assistant"
      >
        <Sparkles className="w-4 h-4 text-blue-400" />
        Assistant
      </button>
    );
  }

  return (
    <div className="absolute top-16 right-4 bottom-4 z-30 w-96 bg-neutral-900/95 backdrop-blur-md border border-neutral-700 rounded-lg shadow-2xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-gray-100">Assistant</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="p-1 text-gray-400 hover:text-gray-200 hover:bg-neutral-800 rounded"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400 leading-relaxed">
              Ask about the cluster or the graph on your canvas. The assistant can read
              resources, logs and events, and can propose changes — you decide whether to
              accept them, and nothing is applied without you.
            </p>
            <div className="space-y-1.5">
              {[
                "What's broken in the default namespace?",
                "Add a Redis StatefulSet and wire it to my app",
                "Why is my deployment not ready?",
              ].map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="w-full text-left px-2 py-1.5 text-xs text-gray-300 bg-neutral-800/60 hover:bg-neutral-800 border border-neutral-700/60 rounded transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="max-w-[85%] px-3 py-1.5 bg-blue-600/90 text-white text-xs rounded-lg rounded-br-sm">
                {m.text}
              </div>
            ) : (
              <div className="space-y-2">
                {(m.tools || []).map((t, ti) => {
                  // Nested calls arrive as "inspector.diagnose"; the prefix is
                  // the specialist the supervisor delegated to.
                  const [agent, tool] = t.name.includes(".")
                    ? t.name.split(".", 2)
                    : [null, t.name];
                  return (
                    <div key={ti} className="flex items-center gap-1.5 text-[10px] text-gray-500">
                      <Wrench className="h-3 w-3 flex-shrink-0" />
                      {agent && (
                        <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-medium text-blue-300">
                          {agent}
                        </span>
                      )}
                      <span className="font-mono">{tool}</span>
                      {t.detail && <span className="truncate opacity-70">{t.detail}</span>}
                    </div>
                  );
                })}

                {m.text && (
                  <div className="text-xs text-gray-200 whitespace-pre-wrap leading-relaxed">
                    {m.text}
                  </div>
                )}

                {m.patch && m.patchState === "pending" && (
                  <div className="border border-blue-900/50 bg-blue-950/20 rounded p-2 space-y-2">
                    <div className="text-[11px] text-blue-200 font-medium">
                      {m.patch.summary || "Proposed change"}
                    </div>
                    <PatchSummary patch={m.patch} />
                    <div className="flex gap-2">
                      <button
                        onClick={() => decide(i, true)}
                        className="flex-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[11px] rounded flex items-center justify-center gap-1"
                      >
                        <Check className="w-3 h-3" />
                        Accept
                      </button>
                      <button
                        onClick={() => decide(i, false)}
                        className="flex-1 px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-gray-300 text-[11px] rounded flex items-center justify-center gap-1"
                      >
                        <Ban className="w-3 h-3" />
                        Reject
                      </button>
                    </div>
                  </div>
                )}

                {m.patchState === "rejected" && (
                  <div className="text-[10px] text-gray-500 italic">Proposal rejected.</div>
                )}

                {m.error && (
                  <div className="flex gap-1.5 text-[11px] text-red-300 bg-red-950/30 border border-red-900/40 rounded p-2">
                    <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                    <span>{m.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-[11px] text-gray-500">
            <Loader2 className="w-3 h-3 animate-spin" />
            Thinking…
          </div>
        )}
      </div>

      <div className="p-2 border-t border-neutral-800 space-y-2">
        <button
          onClick={() =>
            send(
              `Diagnose the ${activeNamespace === "all" ? "default" : activeNamespace} namespace and tell me what is wrong.`
            )
          }
          disabled={busy}
          className="w-full px-2 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 border border-neutral-700 rounded text-[11px] text-gray-300 flex items-center justify-center gap-1.5 transition-colors"
        >
          <Stethoscope className="w-3 h-3" />
          Diagnose this namespace
        </button>

        {selectedNodeId && (
          <button
            onClick={explainSelected}
            disabled={busy}
            className="w-full px-2 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 border border-neutral-700 rounded text-[11px] text-gray-300 flex items-center justify-center gap-1.5 transition-colors"
          >
            <BookOpen className="w-3 h-3" />
            Explain the selected node
          </button>
        )}

        <form
          onSubmit={e => {
            e.preventDefault();
            send(input);
          }}
          className="flex gap-1.5"
        >
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about your cluster…"
            disabled={busy}
            className="flex-1 px-2 py-1.5 text-xs bg-neutral-800 border border-neutral-700 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="px-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}

/** Shows exactly what a proposal would do before the user accepts it. */
function PatchSummary({ patch }: { patch: GraphPatch }) {
  const lines: string[] = [];

  for (const n of patch.addNodes || []) {
    lines.push(`+ ${n.kind} ${n.name}`);
  }
  for (const e of patch.addEdges || []) {
    lines.push(`→ connect ${e.source} to ${e.target}`);
  }
  for (const u of patch.updateNodes || []) {
    lines.push(`~ update ${u.id}`);
  }

  if (lines.length === 0) return null;

  return (
    <div className="text-[10px] font-mono text-gray-400 space-y-0.5">
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}
