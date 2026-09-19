// Verifies the pairing token from the browser's side: a fresh browser is
// refused and asked, the printed link pairs silently, and the token does not
// stay in the address bar.
import puppeteer from "puppeteer";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.K8N_BASE || "http://127.0.0.1:8090";
const CHROME = process.env.CHROME || undefined; // undefined: the Chrome puppeteer downloaded
const TOKEN = readFileSync(join(process.env.K8N_HOME || homedir(), ".k8n", "token"), "utf8").trim();

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: { width: 1400, height: 900 },
});

// 1. An unpaired browser is asked for the token, not left with broken panels.
const cold = await browser.newPage();
await cold.goto(`${BASE}/canvas`, { waitUntil: "networkidle2", timeout: 60000 });
await cold.evaluate(() => {
  localStorage.clear();
  sessionStorage.clear();
});
await cold.reload({ waitUntil: "networkidle2" });
await sleep(3000);

let text = await cold.evaluate(() => document.body.innerText);
check("an unpaired browser is asked to pair", /Pair with your k8n/i.test(text));
check("it says where to find the token", /Open this link to pair/i.test(text));

// 2. Pasting the token pairs it.
await cold.type('input[aria-label="Pairing token"]', TOKEN, { delay: 5 });
await cold.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Pair");
  btn?.click();
});
await sleep(4000);
text = await cold.evaluate(() => document.body.innerText);
check("pasting the token pairs the browser", !/Pair with your k8n/i.test(text));
await cold.close();

// 3. The printed link pairs without anyone typing anything.
const fresh = await browser.newPage();
await fresh.goto(`${BASE}/canvas?t=${encodeURIComponent(TOKEN)}`, {
  waitUntil: "networkidle2",
  timeout: 60000,
});
await sleep(3000);
text = await fresh.evaluate(() => document.body.innerText);
check("the printed link pairs silently", !/Pair with your k8n/i.test(text));

const url = fresh.url();
check("the token is taken out of the address bar", !/[?&]t=/.test(url), url);

const stored = await fresh.evaluate(() => localStorage.getItem("k8n_token"));
check("it is kept for next time", stored === TOKEN);

// 4. A paired browser can actually use the API, including the live stream.
// A route that needs no cluster, so this tests pairing rather than whether
// Kubernetes happens to be running today.
const listed = await fresh.evaluate(async () => {
  const res = await fetch("/api/graph/list", {
    headers: { "X-K8n-Token": localStorage.getItem("k8n_token") || "" },
  });
  return res.status;
});
check("a paired browser can call the API", listed === 200, `status ${listed}`);

const streamed = await fresh.evaluate(
  token =>
    new Promise(resolve => {
      const es = new EventSource(`/api/cluster/watch?t=${encodeURIComponent(token)}`);
      const done = ok => {
        es.close();
        resolve(ok);
      };
      es.onmessage = () => done(true);
      es.onerror = () => done(false);
      setTimeout(() => done(false), 12000);
    }),
  TOKEN
);
check("the live stream works with the token in the query", streamed);

// 5. Another origin cannot read the token, which is the point of it.
const leaked = await fresh.evaluate(async () => {
  try {
    const res = await fetch("/api/cluster/contexts"); // no header: the page's own fetch
    return res.status;
  } catch {
    return -1;
  }
});
check("a request without the header is still refused", leaked === 401, `status ${leaked}`);

await browser.close();
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
