// Drives the assistant setup form in a real browser against a stub provider,
// then asks the assistant a question and reads the answer.
import http from "node:http";
import puppeteer from "puppeteer";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.K8N_BASE || "http://127.0.0.1:8090";
const CHROME = process.env.CHROME || undefined; // undefined: the Chrome puppeteer downloaded
const TOKEN = readFileSync(join(process.env.K8N_HOME || homedir(), ".k8n", "token"), "utf8").trim();
const STUB_PORT = 9098;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clickText = (page, text, sel = "button, a, div, span, option") =>
  page.evaluate(
    (t, s) => {
      const hits = [...document.querySelectorAll(s)].filter(e => (e.textContent || "").trim() === t);
      const el = hits[0] || [...document.querySelectorAll(s)].find(e => (e.textContent || "").includes(t));
      if (!el) return false;
      el.click();
      return true;
    },
    text,
    sel
  );

const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}");
    const carriesToolResult = parsed.messages.some(m => m.role === "tool");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: carriesToolResult
              ? { role: "assistant", content: "Your deployment cannot pull its image." }
              : { role: "assistant", content: "Your deployment cannot pull its image." },
          },
        ],
      })
    );
  });
});
await new Promise(r => stub.listen(STUB_PORT, "127.0.0.1", r));

// Start from no configuration at all.
await fetch(`${BASE}/api/ai/config`, { method: "DELETE", headers: { "X-K8n-Token": TOKEN } });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: { width: 1500, height: 1000 },
});
const page = await browser.newPage();
await page.goto(`${BASE}/canvas?t=${TOKEN}`, { waitUntil: "networkidle2", timeout: 60000 });
await sleep(2500);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(b =>
    (b.textContent || "").includes("Just open the canvas")
  );
  btn?.click();
});
await sleep(1200);
await page.keyboard.press("Escape");
await sleep(400);

// --- the panel offers setup, not an env var ---------------------------------
// The launcher's text is "Assistant off" when unconfigured, so match buttons
// rather than any element containing the word.
const opened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(b =>
    (b.textContent || "").trim().startsWith("Assistant")
  );
  if (!btn) return false;
  btn.click();
  return true;
});
await sleep(1500);
check("the assistant launcher is on the canvas", opened);
let text = await page.evaluate(() => document.body.innerText);
check("an unconfigured assistant offers a provider chooser", /Provider/i.test(text) && /API key/i.test(text));
check("it no longer tells you to set an env var", !/GEMINI_API_KEY/.test(text));

// The toolbar has a namespace <select> too, so find the one that is actually
// the provider chooser and work inside its panel.
const providerInfo = await page.evaluate(() => {
  const select = [...document.querySelectorAll("select")].find(s =>
    [...s.options].some(o => o.value === "openai")
  );
  if (!select) return null;
  select.dataset.test = "provider";
  const panel = select.closest("div.absolute");
  if (panel) panel.dataset.test = "aipanel";
  return [...select.options].map(o => o.textContent);
});
const labels = providerInfo || [];
check("every provider is listed", labels.length >= 6, `${labels.length} options`);
check(
  "the big names are there",
  ["OpenAI", "Anthropic", "Mistral", "DeepSeek", "Z.AI", "OpenRouter"].every(n =>
    labels.some(l => l.includes(n))
  ),
  labels.join(", ")
);

// --- configure the stub through the form ------------------------------------
await page.select('select[data-test="provider"]', "custom");
await sleep(400);

const setField = async (label, value) => {
  const ok = await page.evaluate(
    (lbl, val) => {
      const panel = document.querySelector('[data-test="aipanel"]') || document;
      const field = [...panel.querySelectorAll("label")].find(l =>
        (l.textContent || "").toLowerCase().includes(lbl)
      );
      const input = field?.querySelector("input");
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, val);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    label,
    value
  );
  return ok;
};

check("the model field is editable", await setField("model", "stub-model"));
check("the endpoint field is editable", await setField("endpoint", `http://127.0.0.1:${STUB_PORT}`));
check("the key field is editable", await setField("api key", "browser-key-0987654321"));

// Test first, the way a user would.
await clickText(page, "Test");
await sleep(3000);
text = await page.evaluate(() => document.body.innerText);
check("Test says whether the provider answered", /answered/i.test(text), text.match(/.{0,50}[Aa]nswered.{0,40}/)?.[0]?.replace(/\s+/g, " ") || "");

await clickText(page, "Save");
await sleep(3000);
text = await page.evaluate(() => document.body.innerText);
check("saving switches the assistant on", /Ask about the cluster|Diagnose this namespace/i.test(text));

const shown = await page.evaluate(() => document.body.innerText);
check("the key is never shown back", !shown.includes("browser-key-0987654321"));
check("the model in use is on the header", /stub-model/.test(shown));

// --- ask it something --------------------------------------------------------
const asked = await page.evaluate(() => {
  const input = [...document.querySelectorAll("input")].find(i =>
    (i.placeholder || "").includes("Ask about")
  );
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "why is my deployment broken?");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.closest("form").requestSubmit();
  return true;
});
check("the chat box is there once configured", asked);
await sleep(6000);
text = await page.evaluate(() => document.body.innerText);
check("the assistant answers in the panel", /cannot pull its image/i.test(text), text.match(/.{0,60}cannot pull.{0,20}/)?.[0]?.replace(/\s+/g, " ") || "");

// --- and can be changed or forgotten afterwards ------------------------------
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(
    b => b.getAttribute("aria-label") === "Assistant settings"
  );
  btn?.click();
});
await sleep(800);
text = await page.evaluate(() => document.body.innerText);
check("the provider can be changed later", /Assistant settings/i.test(text) && /Forget this key/i.test(text));

const hint = await page.evaluate(() => {
  const line = [...document.querySelectorAll("span")].find(s => /^Saved key/.test(s.textContent || ""));
  return line?.textContent || "";
});
const provider = await page.evaluate(() => {
  const select = document.querySelector("select");
  return { value: select?.value || "", options: select?.options.length || 0 };
});
check("reopened settings still show the provider", provider.value !== "" && provider.options >= 6, `${provider.value} of ${provider.options}`);
check("the saved key shows only as a hint", /…/.test(hint) && !hint.includes("0987654321"), hint);

await clickText(page, "Forget this key");
await sleep(2500);
const after = await (await fetch(`${BASE}/api/ai/status`, { headers: { "X-K8n-Token": TOKEN } })).json();
check("forgetting really removes it", after.enabled === false, JSON.stringify(after.keyHint));

await browser.close();
stub.close();
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
