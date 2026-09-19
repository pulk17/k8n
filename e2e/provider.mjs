// Verifies the multi-provider path end to end without a real API key: a stub
// server speaking the OpenAI chat format stands in for the provider, so the
// whole loop — config, client, tool declarations, a tool call, the result going
// back, the final answer — is exercised for real.
import http from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.K8N_BASE || "http://127.0.0.1:8090";
const TOKEN = readFileSync(join(process.env.K8N_HOME || homedir(), ".k8n", "token"), "utf8").trim();
const STUB_PORT = 9099;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const api = (path, options = {}) =>
  fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-K8n-Token": TOKEN,
      ...(options.headers || {}),
    },
  });

// --- the stub provider -------------------------------------------------------
const seen = [];
let rateLimitNext = false; // the next request answers 429 once
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", chunk => (body += chunk));
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}");
    seen.push({ url: req.url, auth: req.headers.authorization, body: parsed });
    if (rateLimitNext) {
      rateLimitNext = false;
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "429 Too Many Requests. Please retry in 1s." } }));
      return;
    }

    // Round 1 asks for a tool; round 2 (which carries the tool result) answers.
    const carriesToolResult = parsed.messages.some(m => m.role === "tool");
    const wantsTools = (parsed.tools || []).length > 0;

    const message =
      wantsTools && !carriesToolResult
        ? {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_abc",
                type: "function",
                function: {
                  name: "list_helm_releases",
                  arguments: JSON.stringify({ namespace: "default" }),
                },
              },
            ],
          }
        : { role: "assistant", content: carriesToolResult ? "ready: I checked." : "ready" };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
});
await new Promise(resolve => stub.listen(STUB_PORT, "127.0.0.1", resolve));

// --- 1. save a provider while k8n is running ---------------------------------
const config = {
  provider: "custom",
  model: "stub-model",
  baseUrl: `http://127.0.0.1:${STUB_PORT}`,
  apiKey: "test-key-1234567890",
};

let res = await api("/api/ai/config", { method: "POST", body: JSON.stringify(config) });
let data = await res.json();
check("a provider can be configured without a restart", res.status === 200 && data.enabled === true, JSON.stringify(data));
check("the key comes back masked, never whole", data.keyHint && !data.keyHint.includes("1234567890"), data.keyHint || "");
check("saving answers with the provider list too", Array.isArray(data.providers) && data.providers.length >= 6, `${data.providers?.length} providers`);

res = await api("/api/ai/status");
data = await res.json();
check("status reports the live provider", data.enabled && data.provider === "custom" && data.model === "stub-model");
check("status offers the provider list to choose from", Array.isArray(data.providers) && data.providers.length >= 6, `${data.providers?.length} providers`);
check("status never returns the key itself", !JSON.stringify(data).includes("test-key-1234567890"));

// --- 2. test connection ------------------------------------------------------
res = await api("/api/ai/config/test", { method: "POST", body: JSON.stringify(config) });
data = await res.json();
check("test connection reaches the provider", res.status === 200 && data.ok === true, data.reply || data.error || "");
check("the request was authenticated as the provider expects", seen.at(-1)?.auth === "Bearer test-key-1234567890");
check("it calls /chat/completions", seen.at(-1)?.url === "/chat/completions", seen.at(-1)?.url);

// --- 3. a full assistant turn, with a tool call ------------------------------
seen.length = 0;
const chat = await api("/api/ai/chat", {
  method: "POST",
  body: JSON.stringify({
    message: "What is wrong with my canvas?",
    history: [],
    namespace: "default",
    depth: "new",
    notes: ["Service selects nothing — no workload matches it."],
    graph: {
      nodes: [
        {
          id: "n1",
          data: { kind: "Deployment", name: "web", namespace: "default", status: "ImagePullBackOff" },
        },
      ],
      edges: [],
    },
  }),
});
const stream = await chat.text();
const events = stream
  .split("\n")
  .filter(line => line.startsWith("data: "))
  .map(line => JSON.parse(line.slice(6)));

check("the turn streams events", events.length > 0, `${events.length} events`);
check("the model's tool call is executed", events.some(e => e.type === "tool"), events.filter(e => e.type === "tool").map(e => e.tool).join(","));
check("the answer comes back as text", events.some(e => e.type === "text" && e.text.includes("ready")), events.find(e => e.type === "text")?.text || "");
check("the stream finishes", events.some(e => e.type === "done"));

// --- 4. what the provider actually received ----------------------------------
const first = seen[0]?.body;
check("the system prompt is sent", first?.messages?.[0]?.role === "system" && first.messages[0].content.includes("k8n"));
check(
  "one agent holds every tool, no sub-agents",
  ["diagnose", "propose_graph_patch"].every(n => (first?.tools || []).some(t => t.function.name === n)) &&
    !(first?.tools || []).some(t => t.function.name.startsWith("ask_")),
  (first?.tools || []).map(t => t.function.name).join(",")
);
check("a question with one tool call costs two requests", seen.length === 2, `${seen.length} requests`);
check(
  "tool schemas are converted to JSON Schema",
  first?.tools?.every(t => !JSON.stringify(t.function.parameters).includes("STRING")),
  JSON.stringify(first?.tools?.[0]?.function?.parameters || {}).slice(0, 90)
);
check("the canvas state reaches the model", JSON.stringify(first?.messages).includes("ImagePullBackOff"));
check("so do the problems already on screen", JSON.stringify(first?.messages).includes("Service selects nothing"));
check("and the reader's level", JSON.stringify(first?.messages).includes("new to Kubernetes"));

const second = seen[1]?.body;
const toolMessage = second?.messages?.find(m => m.role === "tool");
check("the tool result goes back with its call id", toolMessage?.tool_call_id === "call_abc", toolMessage?.tool_call_id || "missing");
check("the assistant turn that asked is replayed", second?.messages?.some(m => m.role === "assistant" && m.tool_calls?.length));

// --- 5. rate limits and history -----------------------------------------------
seen.length = 0;
rateLimitNext = true;
const longHistory = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "model" : "user", text: `turn ${i}` }));
const limited = await (
  await api("/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message: "hi", history: longHistory }),
  })
).text();
check("a rate limit is waited out, not failed", limited.includes("rate_limited") && limited.includes("ready") && !limited.includes('"type":"error"'), `${seen.length} requests`);
const sentTurns = (seen[0]?.body?.messages || []).filter(m => m.role !== "system").length;
check("only the recent conversation is resent", sentTurns <= 7, `${sentTurns} turns sent for 21`);

// --- 6. the saved key stays with its provider ---------------------------------
res = await api("/api/ai/config", {
  method: "POST",
  body: JSON.stringify({ provider: "openai", model: "gpt-4.1-mini", baseUrl: "", apiKey: "" }),
});
check("switching provider does not reuse the other provider's key", res.status === 400, `status ${res.status}`);

// --- 7. forgetting the key ---------------------------------------------------
res = await api("/api/ai/config", { method: "DELETE" });
data = await res.json();
check("forgetting the key turns the assistant off", res.status === 200 && data.enabled === false, JSON.stringify(data));

res = await api("/api/ai/chat", {
  method: "POST",
  body: JSON.stringify({ message: "hello", history: [] }),
});
check("and the assistant refuses politely afterwards", res.status === 503, `status ${res.status}`);

stub.close();
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
