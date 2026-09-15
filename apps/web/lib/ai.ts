import { TOKEN_HEADER, getToken, reportUnauthorized } from "./session";
import { API_URL, request } from "./api";
import { GraphPatch } from "../store/canvasStore";

export interface AIProvider {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  keysUrl?: string;
  note?: string;
}

export interface AIStatus {
  enabled: boolean;
  model: string;
  provider?: string;
  baseUrl?: string;
  /** All the browser is ever told about the key: "sk-1a…9f". */
  keyHint?: string;
  /** "file" when it was set here, "env" when the machine was started with it. */
  source?: string;
  /** What can be chosen, with a starting model for each. */
  providers?: AIProvider[];
  /** The specialists the supervisor can delegate to. */
  agents?: string[];
  /** External MCP servers whose tools the assistant can also call. */
  mcpServers?: string[];
}

export interface AIConfigRequest {
  provider: string;
  model: string;
  baseUrl?: string;
  /** Blank keeps whatever key is already saved. */
  apiKey?: string;
}

export const saveAIConfig = (config: AIConfigRequest) =>
  request<AIStatus>("/api/ai/config", { method: "POST", body: config });

/** Asks the provider for one word, so a wrong key is found here. */
export const testAIConfig = (config: AIConfigRequest) =>
  request<{ ok: boolean; reply?: string }>("/api/ai/config/test", {
    method: "POST",
    body: config,
    timeoutMs: 60000,
  });

export const forgetAIConfig = () =>
  request<AIStatus>("/api/ai/config", { method: "DELETE" });

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
    /** How much to explain: the reader's chosen depth. */
    depth?: string;
    /** Problems the canvas is already showing, so the answer starts there. */
    notes?: string[];
  },
  onEvent: (event: AIEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_URL}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [TOKEN_HEADER]: getToken() },
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 401) reportUnauthorized();

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
