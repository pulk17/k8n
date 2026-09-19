// A provider having a bad day should read as a provider having a bad day.
import http from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.K8N_BASE || "http://127.0.0.1:8090";
const TOKEN = readFileSync(join(process.env.K8N_HOME || homedir(), ".k8n", "token"), "utf8").trim();
const PORT = 9097;

const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`${p ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

let mode = "overloaded";
const stub = http.createServer((req, res) => {
  let body = ""; req.on("data", c => (body += c));
  req.on("end", () => {
    const replies = {
      overloaded: [503, { error: { message: "The model is currently experiencing high demand. Status: UNAVAILABLE" } }],
      badkey:     [401, { error: { message: "Incorrect API key provided" } }],
      nomodel:    [404, { error: { message: "The model `nope-v9` does not exist" } }],
      ratelimit:  [429, { error: { message: "Rate limit reached for requests" } }],
    };
    const [status, payload] = replies[mode];
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  });
});
await new Promise(r => stub.listen(PORT, "127.0.0.1", r));

const test = async () => {
  const res = await fetch(`${BASE}/api/ai/config/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-K8n-Token": TOKEN },
    body: JSON.stringify({ provider: "custom", model: "stub", baseUrl: `http://127.0.0.1:${PORT}`, apiKey: "k" }),
  });
  return res.json();
};

for (const [m, expect] of [
  ["overloaded", /overloaded/i],
  ["badkey", /rejected the key/i],
  ["nomodel", /does not exist at this provider/i],
  ["ratelimit", /rate limit or quota/i],
]) {
  mode = m;
  const out = await test();
  check(`${m}: says what it means`, expect.test(out.error || ""), `${out.error || ""} ${out.hint ? "| " + out.hint : ""}`.trim());
}

// A hung provider must not hold the button for 45 seconds.
const slow = http.createServer((req, res) => { /* never answers */ });
await new Promise(r => slow.listen(9096, "127.0.0.1", r));
const started = Date.now();
const res = await fetch(`${BASE}/api/ai/config/test`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-K8n-Token": TOKEN },
  body: JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://127.0.0.1:9096", apiKey: "k" }),
});
const out = await res.json();
const seconds = Math.round((Date.now() - started) / 1000);
check("a hung provider gives up quickly", seconds <= 25, `${seconds}s`);
check("and says it timed out", /did not answer in time/i.test(out.error || ""), out.error || "");

stub.close(); slow.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
