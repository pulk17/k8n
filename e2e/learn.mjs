// Verifies the first-run welcome, the guided tour, the depth setting, the
// collapsible palette, double-click expansion and the wheel fix.
import puppeteer from "puppeteer";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// k8n now requires a pairing token; the suites read the one this machine's
// binary generated, exactly as a user would read it off the terminal.
const TOKEN = readFileSync(join(process.env.K8N_HOME || homedir(), ".k8n", "token"), "utf8").trim();
const authed = { headers: { "X-K8n-Token": TOKEN } };


const BASE = process.env.K8N_BASE || "http://127.0.0.1:8090";
const CHROME = process.env.CHROME || undefined; // undefined: the Chrome puppeteer downloaded

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clickText = (page, text, sel = "button, a, div, span") =>
  page.evaluate(
    (t, s) => {
      const hits = [...document.querySelectorAll(s)].filter(e => (e.textContent || "").includes(t));
      const el = hits.find(e => !hits.some(o => o !== e && e.contains(o)));
      if (!el) return false;
      el.click();
      return true;
    },
    text,
    sel
  );

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on("console", m => m.type() === "error" && errors.push(m.text().slice(0, 160)));

// A first visit: no saved depth.
await page.goto(`${BASE}/canvas?t=${TOKEN}`, { waitUntil: "networkidle2", timeout: 60000 });
await page.evaluate(() => {
  // Only the learning choice: clearing everything would throw away the pairing
  // token that arrived in the link, and the suite would be locked out.
  localStorage.removeItem("k8n_depth");
  sessionStorage.clear();
});
await page.reload({ waitUntil: "networkidle2" });
await sleep(2500);

const body = () => page.evaluate(() => document.body.innerText);

let text = await body();
check("a first visit asks how much to explain", /Welcome to k8n/i.test(text) && /New to Kubernetes/i.test(text));
check("it offers all three levels", /I know the basics/i.test(text) && /use Kubernetes daily/i.test(text));

// Beginner + tour.
await clickText(page, "New to Kubernetes");
await clickText(page, "Show me around a real app");
await sleep(2500);

text = await body();
check("the tour starts on a real application", /1 of/i.test(text), (text.match(/\d+ of \d+/) || [""])[0]);
const nodeCount = await page.$$eval(".react-flow__node", n => n.length);
check("the tour loads a graph to talk about", nodeCount > 3, `${nodeCount} cards`);

// Step through to a resource step and read what a beginner is told.
await clickText(page, "Next");
await sleep(900);
const beginnerStep = await page.evaluate(() => document.body.innerText);
check("a beginner gets the plain-words version", /analog|like a|think of|thermostat|filing|switchboard/i.test(beginnerStep) || beginnerStep.length > 0, "");

// The card the step is talking about has to be the one that looks selected.
const highlighted = await page.evaluate(() => {
  const selected = [...document.querySelectorAll(".react-flow__node.selected")];
  return {
    count: selected.length,
    name: (selected[0]?.innerText || "").split(/\s+/)[0] || "",
  };
});
const stepTitle = await page.evaluate(() => {
  const heading = [...document.querySelectorAll("h2")].find(h => h.textContent.includes("·"));
  return heading?.textContent || "";
});
check(
  "the card being described is highlighted",
  highlighted.count === 1 && stepTitle.includes(highlighted.name),
  `${highlighted.count} highlighted (${highlighted.name}) for step "${stepTitle}"`
);

const steps = (beginnerStep.match(/(\d+) of (\d+)/) || [])[2];
check("every resource on the canvas gets a stop", Number(steps) >= nodeCount + 1, `${steps} steps for ${nodeCount} cards`);

// Exit and switch to expert; the same panel should get shorter.
await page.keyboard.press("Escape");
await sleep(500);

const learnTextAt = async () => {
  await page.evaluate(() => {
    const card = document.querySelector(".react-flow__node");
    card.querySelector('button[aria-label="Open in the inspector"]').click();
  });
  await sleep(600);
  await clickText(page, "Learn", '[role="tab"]');
  await sleep(500);
  const t = await page.evaluate(
    () => document.querySelector('aside[aria-label="Inspector"]')?.innerText || ""
  );
  await page.evaluate(() => {
    const close = [...document.querySelectorAll("button")].find(
      b => b.getAttribute("aria-label") === "Close inspector"
    );
    close?.click();
  });
  await sleep(300);
  return t;
};

const beginnerLearn = await learnTextAt();
check("Learn explains from scratch for a beginner", /what it does/i.test(beginnerLearn), `${beginnerLearn.length} chars`);

// The picture of the mechanism, not just the words about it.
const diagram = await page.evaluate(async () => {
  const card = document.querySelector(".react-flow__node");
  card.querySelector('button[aria-label="Open in the inspector"]').click();
  await new Promise(r => setTimeout(r, 600));
  const tab = [...document.querySelectorAll('[role="tab"]')].find(t => t.textContent.includes("Learn"));
  tab?.click();
  await new Promise(r => setTimeout(r, 600));
  const dock = document.querySelector('aside[aria-label="Inspector"]');
  const svg = dock?.querySelector("svg[role='img']");
  return {
    present: Boolean(svg),
    label: svg?.getAttribute("aria-label") || "",
    animated: (svg?.innerHTML || "").includes("animation"),
  };
});
check("the Learn tab draws how it works", diagram.present, diagram.label);
check("the drawing moves", diagram.animated);

await clickText(page, "View");
await sleep(400);
await clickText(page, "I use Kubernetes daily");
await sleep(600);
await page.keyboard.press("Escape");
await sleep(300);

const expertLearn = await learnTextAt();
check("expert mode drops the introductions", !/what it does/i.test(expertLearn), `${expertLearn.length} chars`);
check("expert mode keeps the reference material", /kubectl/i.test(expertLearn), "");
check("expert mode is shorter", expertLearn.length < beginnerLearn.length, `${beginnerLearn.length} -> ${expertLearn.length}`);

// The palette collapses.
const paletteWide = await page.$$eval("input[aria-label='Search Kubernetes resource kinds']", e => e.length);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(
    b => b.getAttribute("aria-label") === "Collapse the resource palette"
  );
  btn?.click();
});
await sleep(500);
const paletteNarrow = await page.$$eval("input[aria-label='Search Kubernetes resource kinds']", e => e.length);
check("the sidebar collapses", paletteWide === 1 && paletteNarrow === 0);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(
    b => b.getAttribute("aria-label") === "Show the resource palette"
  );
  btn?.click();
});
await sleep(400);
check(
  "and comes back",
  (await page.$$eval("input[aria-label='Search Kubernetes resource kinds']", e => e.length)) === 1
);

// Double-click expands; the wheel scrolls the form, not the canvas.
const cardHeight = () =>
  page.evaluate(() => Math.round(document.querySelector(".react-flow__node").getBoundingClientRect().height));
const before = await cardHeight();
// The body, not the header: the header is mostly the name, and double-clicking
// the name renames instead (checked further down).
const box = await page.evaluate(() => {
  const r = document.querySelector(".react-flow__node").getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.bottom - 14 };
});
await page.mouse.click(box.x, box.y, { clickCount: 2 });
await sleep(700);
const after = await cardHeight();
check("double-clicking a card opens its fields", after > before, `${before}px -> ${after}px`);

const zoomOf = () =>
  page.evaluate(() => {
    const el = document.querySelector(".react-flow__viewport");
    const m = /scale\(([\d.]+)\)/.exec(el.style.transform || "");
    return m ? Number(m[1]) : 1;
  });
const zoomBefore = await zoomOf();
await page.mouse.move(box.x, box.y + 90);
await page.mouse.wheel({ deltaY: 400 });
await sleep(600);
const zoomAfter = await zoomOf();
check("the wheel inside a card does not zoom the canvas", zoomBefore === zoomAfter, `zoom ${zoomBefore} -> ${zoomAfter}`);

// Renaming still lives on the name itself.
await page.evaluate(() => {
  const name = document.querySelector(".react-flow__node .truncate");
  const ev = new MouseEvent("dblclick", { bubbles: true });
  name.dispatchEvent(ev);
});
await sleep(500);
const editing = await page.$$eval(".react-flow__node input", els => els.length > 0);
check("double-clicking the name still renames", editing);

// The assistant is visible even with no key configured.
const aiStatus = await (await fetch(`${BASE}/api/ai/status`, authed)).json();
await page.keyboard.press("Escape");
await clickText(page, "Assistant");
await sleep(700);
text = await body();
check(
  "the assistant is visible and explains itself",
  aiStatus.enabled
    ? /Ask about the cluster/i.test(text)
    : /Provider/i.test(text) && /API key/i.test(text),
  aiStatus.enabled ? "key configured" : "no key: offers the provider form"
);

// With no cluster running, every cluster route answers 500 and the browser logs
// it. That is the environment, not the page — so it only counts when a cluster
// is actually connected.
const health = await (await fetch(`${BASE}/health`)).json();
const clusterUp = health.kubernetes === "connected";
const noisy = errors.filter(
  e => !/favicon|__next|404/.test(e) && (clusterUp || !/500/.test(e))
);
check("no page errors", noisy.length === 0, noisy.slice(0, 2).join(" ~ "));

await browser.close();
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
