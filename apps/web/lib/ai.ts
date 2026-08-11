import { API_URL, request } from "./api";
import { GraphPatch } from "../store/canvasStore";

export interface AIStatus {
  enabled: boolean;
  model: string;
  /** The specialists the supervisor can delegate to. */
  agents?: string[];
  /** External MCP servers whose tools the assistant can also call. */
  mcpServers?: string[];
}

/** One streamed step of an assistant turn. */
export interface AIEvent {
  type: "text" | "tool" | "patch" | "error" | "done";
  text?: string;
  tool?: string;
  detail?: string;
  patch?: GraphPatch;
  message?: string;
}

export const fetchAIStatus = () =>
  request<AIStatus>("/api/ai/status").catch(() => ({ enabled: false, model: "" }));

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

/**
 * Streams an assistant turn over SSE.
 *
 * The response is a sequence of `data: {json}` frames; each is surfaced through
 * onEvent so the panel can show tool calls as they happen rather than waiting
 * for the whole answer.
 */
export async function streamChat(
  body: {
    message: string;
    history: ChatTurn[];
    graph: { nodes: unknown[]; edges: unknown[] };
    namespace: string;
  },
  onEvent: (event: AIEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_URL}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.hint || data.error || `Assistant request failed (${res.status})`);
  }
  if (!res.body) throw new Error("The assistant returned no stream.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";

    for (const frame of frames) {
      const line = frame.split("\n").find(l => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as AIEvent);
      } catch {
        // A malformed frame should not kill the stream.
      }
    }
  }
}

export const explainNode = (graph: { nodes: unknown[]; edges: unknown[] }, nodeId: string) =>
  request<{ explanation: string }>("/api/ai/explain", {
    method: "POST",
    body: { graph, nodeId },
    timeoutMs: 60000,
  });
