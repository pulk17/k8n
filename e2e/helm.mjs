// Verifies the Helm flow and the restored node expander against a real browser.
// The Browser pane cannot drive /canvas (it sits inside <Suspense>, so React 19
// leaves it unhydrated without trusted input).
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

// Clicks through the DOM rather than at coordinates: the workflow dialog and
// the dock overlay parts of the canvas, and a real pointer click on a covered
// element lands on whatever is in front of it.
async function clickText(page, text, selector = "button, a, div, span") {
  return page.evaluate(
    (t, sel) => {
      const all = [...document.querySelectorAll(sel)];
      const hits = all.filter(el => (el.textContent || "").includes(t));
      const target = hits.find(el => !hits.some(other => other !== el && el.contains(other)));
      if (!target) return false;
      target.click();
      return true;
    },
    text,
    selector
  );
}

// Rendering a chart asks the cluster which API versions it supports, so this
// whole suite needs one. Say so rather than reporting eight failures that are
// really "Kubernetes is not running".
const health = await (await fetch(`${BASE}/health`, authed)).json();
if (health.kubernetes !== "connected") {
  console.log("SKIPPED: no cluster connected — start one and run this again");
  process.exit(0);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--window-size=1600,1000"],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const pageErrors = [];
page.on("console", m => m.type() === "error" && pageErrors.push(m.text().slice(0, 200)));

await page.goto(`${BASE}/canvas?t=${TOKEN}`, { waitUntil: "networkidle2", timeout: 60000 });
await sleep(2500);

// A first visit now asks how much to explain before anything else; answer it so
// the workflow dialog behind it is reachable.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(b =>
    (b.textContent || "").includes("Just open the canvas")
  );
  btn?.click();
});
await sleep(1200);


// The example gives the expander something to expand.
await clickText(page, "Open workflow manager");
await sleep(800);
await clickText(page, "Nginx starter");
await sleep(1500);

// --- 1. live chart search -----------------------------------------------------
await clickText(page, "Helm Charts");
await sleep(500);
await page.type('input[aria-label="Search Helm charts on Artifact Hub"]', "prometheus", { delay: 40 });
// No Enter, and no click on a button: typing alone must be enough.
await sleep(3500);
const chartCards = '[draggable=true]';
const cards = await page.$$eval(chartCards, els => els.length);
check("typing searches without pressing Enter", cards > 0, `${cards} charts listed`);

const firstChart = await page.$$eval("[draggable=true]", els =>
  els.slice(0, 1).map(el => el.textContent.slice(0, 40))
);
check("results name the chart", firstChart.length > 0, firstChart[0] || "");

// --- 2. drop a chart on the canvas -------------------------------------------
const chart = await (await fetch(`${BASE}/api/helm/search?q=prometheus`, authed)).json();
// Bitnami on purpose: it is the case that fails in the cluster, and the one
// the warning exists for.
const pick =
  chart.find(c => c.repository?.name === "bitnami" && c.repository?.url) ||
  chart.find(c => c.repository?.url) ||
  chart[0];
console.log(`chart under test: ${pick.repository?.name}/${pick.name}`);

const nodesBefore = await page.$$eval(".react-flow__node", n => n.length);
await page.evaluate(chartJson => {
  const pane = document.querySelector(".react-flow__pane");
  const box = pane.getBoundingClientRect();
  const dt = new DataTransfer();
  dt.setData("application/reactflow", "k8sNode");
  dt.setData("application/k8sKind", "HelmRelease");
  dt.setData("application/helmChart", chartJson);
  pane.dispatchEvent(
    new DragEvent("drop", {
      dataTransfer: dt,
      bubbles: true,
      cancelable: true,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    })
  );
}, JSON.stringify(pick));
await sleep(1200);

const nodesAfter = await page.$$eval(".react-flow__node", n => n.length);
check("dropping a chart adds a release node", nodesAfter === nodesBefore + 1, `${nodesBefore} -> ${nodesAfter}`);

// --- 3. the chart opens the dock, already rendering ---------------------------
const dockText = () =>
  page.evaluate(() => {
    const dock = document.querySelector('aside[aria-label="Inspector"]');
    return dock ? dock.innerText : "";
  });

await sleep(500);
let text = await dockText();
check("dropping a chart opens the inspector on it", /Chart/i.test(text), text.slice(0, 60).replace(/\s+/g, " "));

// Rendering downloads the chart; give it room.
let rendered = "";
for (let i = 0; i < 40; i++) {
  await sleep(1500);
  rendered = await dockText();
  // Not "object": the chart's own description says that before any render.
  if (/\b(Deployment|StatefulSet|Service)\b/.test(rendered) || /could not render/i.test(rendered)) break;
}
check("the chart is rendered without asking", /object/i.test(rendered), rendered.slice(0, 120).replace(/\s+/g, " "));
// Listed as the objects it creates; each opens to its own YAML.
check("what the chart creates is listed", /\b(Deployment|StatefulSet|Service)\b/.test(rendered), "");
if (!/object/i.test(rendered)) console.log("---- dock said: " + rendered.slice(0, 600));

// --- 4. the image warning, before anything is installed ----------------------
const bitnami = /bitnami/i.test(JSON.stringify(pick));
if (bitnami) {
  check(
    "unpullable Bitnami images are flagged before install",
    /cannot be pulled/i.test(rendered),
    rendered.match(/.{0,60}cannot be pulled.{0,40}/i)?.[0]?.replace(/\s+/g, " ") || "no warning"
  );
  check("the warning says how to fix it", /bitnamilegacy/i.test(rendered), "");
}

// --- 5. drawing what the chart installs --------------------------------------
const drew = await clickText(page, "Draw these on the canvas");
await sleep(2500);
const nodesDrawn = await page.$$eval(".react-flow__node", n => n.length);
check("the chart's resources are drawn on the canvas", drew && nodesDrawn > nodesAfter, `${nodesAfter} -> ${nodesDrawn}`);

const dashed = await page.$$eval(".react-flow__node", els =>
  els.filter(el => el.querySelector(".border-dashed")).length
);
check("rendered resources are drawn as not-yours", dashed > 0, `${dashed} dashed cards`);

const edges = await page.$$eval(".react-flow__edge", els => els.length);
check("they are wired to the release that installs them", edges > 0, `${edges} wires`);

// --- 6. compile leaves them alone --------------------------------------------
await clickText(page, "Review & apply");
// Compiling re-renders the chart, which is a download; wait for the dialog.
let preview = "";
let objects = null;
for (let i = 0; i < 30; i++) {
  await sleep(1500);
  preview = await page.evaluate(() => document.body.innerText);
  objects = preview.match(/(\d+)\s+direct\s+resources?/i);
  if (objects) break;
}
// The example workflow's four resources compile; the chart's do not, and
// neither does the release itself (Helm installs that).
check(
  "chart resources are not compiled as plain YAML",
  objects ? Number(objects[1]) === 4 : false,
  `${objects?.[0] || "no preview"} of ${nodesDrawn} cards`
);
check("the preview repeats the image warning", /cannot be pulled/i.test(preview) || !bitnami, "");
await page.keyboard.press("Escape");
await clickText(page, "Close");
await sleep(800);

// --- 7. the restored expander -------------------------------------------------
await page.evaluate(() => {
  const dock = [...document.querySelectorAll("button")].find(
    b => b.getAttribute("aria-label") === "Close inspector"
  );
  dock?.click();
});
await sleep(500);

const cardHeight = async () =>
  page.evaluate(() => {
    const node = document.querySelector(".react-flow__node");
    return node ? Math.round(node.getBoundingClientRect().height) : 0;
  });

const before = await cardHeight();
await page.evaluate(() => {
  const node = document.querySelector(".react-flow__node");
  node.querySelector('button[aria-label^="Expand"]')?.click();
});
await sleep(600);
const after = await cardHeight();
check("the card expands in place again", after > before, `${before}px -> ${after}px`);

const inlineFields = await page.evaluate(() => {
  const node = document.querySelector(".react-flow__node");
  return node.querySelectorAll("input, textarea, select").length;
});
check("the expanded card edits the resource", inlineFields > 0, `${inlineFields} fields`);

// --- 8. the dock is opened deliberately, not by selecting ---------------------
await page.evaluate(() => {
  const node = document.querySelector(".react-flow__node");
  node.querySelector('button[aria-label^="Collapse"]')?.click();
});
await sleep(400);
await page.evaluate(() => {
  document.querySelector(".react-flow__pane").click();
});
await sleep(400);
await page.evaluate(() => {
  const cards = document.querySelectorAll(".react-flow__node");
  cards[cards.length - 1].querySelector("div").click();
});
await sleep(600);
let dockNow = await page.$$eval('aside[aria-label="Inspector"]', els => els.length);
check("clicking a card no longer takes over the right-hand dock", dockNow === 0, `${dockNow} docks`);

await page.evaluate(() => {
  const cards = document.querySelectorAll(".react-flow__node");
  cards[cards.length - 1].querySelector('button[aria-label="Open in the inspector"]').click();
});
await sleep(800);
dockNow = await page.$$eval('aside[aria-label="Inspector"]', els => els.length);
check("the panel button opens the dock", dockNow === 1, `${dockNow} docks`);

const noisy = pageErrors.filter(e => !/favicon|404|500/.test(e));
check("no page errors", noisy.length === 0, noisy.slice(0, 2).join(" ~ "));

await browser.close();
const passed = results.filter(r => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
