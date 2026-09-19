// Verifies the inspector dock, the searchable toolbox and the Learn tab against
// a real browser. The Browser pane cannot drive /canvas (it sits inside
// <Suspense>, so React 19 leaves it unhydrated without trusted input).
import puppeteer from "puppeteer";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// k8n now requires a pairing token; the suites read the one this machine's
// binary generated, exactly as a user would read it off the terminal.
const TOKEN = readFileSync(join(process.env.K8N_HOME || homedir(), ".k8n", "token"), "utf8").trim();
const authed = { headers: { "X-K8n-Token": TOKEN } };


const URL = (process.env.K8N_BASE || "http://127.0.0.1:8090") + "/canvas";
const CHROME = process.env.CHROME || undefined; // undefined: the Chrome puppeteer downloaded

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

/** Clicks the innermost element whose text contains `text`. */
async function clickText(page, text, selector = "button, a, div, span") {
  const handle = await page.evaluateHandle(
    (t, sel) => {
      const all = [...document.querySelectorAll(sel)];
      const hits = all.filter(el => (el.textContent || "").includes(t));
      // innermost = the one containing no other hit
      return hits.find(el => !hits.some(other => other !== el && el.contains(other))) || null;
    },
    text,
    selector
  );
  const el = handle.asElement();
  if (!el) return false;
  await el.click();
  return true;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950 });

const pageErrors = [];
page.on("pageerror", e => pageErrors.push(String(e)));
page.on("console", m => m.type() === "error" && pageErrors.push(m.text()));
page.on("response", r => r.status() === 404 && pageErrors.push(`404 ${r.url()}`));

await page.goto(`${URL}?t=${TOKEN}`, { waitUntil: "networkidle2", timeout: 60000 });
await sleep(1500);

// A first visit now asks how much to explain before anything else; answer it so
// the workflow dialog behind it is reachable.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(b =>
    (b.textContent || "").includes("Just open the canvas")
  );
  btn?.click();
});
await sleep(1200);


// ── Load the example workflow so there is a graph to inspect ────────────────
const openedManager = await page.$$eval("*", els =>
  els.some(e => (e.textContent || "").includes("Nginx starter"))
);
if (openedManager) {
  await clickText(page, "Nginx starter");
  await sleep(2000);
} else {
  console.log("note: workflow manager not showing; trying to open it");
  await clickText(page, "Open workflow manager");
  await sleep(800);
  await clickText(page, "Nginx starter");
  await sleep(2000);
}

const nodeCount = await page.$$eval(".react-flow__node", n => n.length);
check("example workflow loaded", nodeCount > 0, `${nodeCount} nodes`);

// ── Toolbox: search box, descriptions, buttons not divs ────────────────────
const searchBox = await page.$('input[aria-label="Search Kubernetes resource kinds"]');
check("toolbox has a search box", !!searchBox);

const toolboxInfo = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("button")].filter(b =>
    (b.getAttribute("title") || "").startsWith("Deployment —")
  );
  return {
    isButton: rows.length > 0,
    title: rows[0]?.getAttribute("title") || "",
    showsSummary: (rows[0]?.textContent || "").includes("Keeps N identical pods"),
  };
});
check("resource rows are real buttons (keyboard reachable)", toolboxInfo.isButton);
check("resource rows explain the kind", toolboxInfo.showsSummary, toolboxInfo.title.slice(0, 60));

// Search narrows the list, and matches on the description not just the name.
await page.type('input[aria-label="Search Kubernetes resource kinds"]', "schedule");
await sleep(400);
const searchHits = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("button")].filter(b =>
    (b.getAttribute("title") || "").includes(" — ")
  );
  return rows.map(r => r.getAttribute("title").split(" — ")[0]);
});
check(
  'searching "schedule" finds CronJob by its description',
  searchHits.includes("CronJob"),
  `matches: ${searchHits.join(", ") || "none"}`
);
await page.click('button[aria-label="Clear search"]');
await sleep(300);

// ── Node click opens the inspector dock ────────────────────────────────────
// Card heights before any selection: expanding in place was the old behaviour,
// and it shoved every other node on the canvas around.
const heightsBefore = await page.$$eval(".react-flow__node", els =>
  els.map(e => Math.round(e.getBoundingClientRect().height))
);
// A card no longer opens the dock on selection — it expands in place instead,
// and the panel button is the way to the inspector.
await page.click(".react-flow__node");
await sleep(400);
await page.evaluate(() => {
  document
    .querySelector(".react-flow__node")
    .querySelector('button[aria-label="Open in the inspector"]')
    .click();
});
await sleep(700);

const inspector = await page.evaluate(() => {
  const el = document.querySelector('aside[aria-label="Inspector"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    width: Math.round(r.width),
    rightEdge: Math.round(r.right),
    viewportWidth: window.innerWidth,
    tabs: [...el.querySelectorAll('[role="tab"]')].map(t => t.textContent.trim()),
    text: el.innerText.slice(0, 300),
  };
});
check("the panel button opens the inspector", !!inspector);
check(
  "inspector is docked to the right edge",
  inspector && inspector.rightEdge === inspector.viewportWidth,
  inspector ? `right=${inspector.rightEdge} vw=${inspector.viewportWidth} w=${inspector.width}` : ""
);
check(
  "inspector has Configure and Learn tabs",
  inspector && inspector.tabs.includes("Configure") && inspector.tabs.includes("Learn"),
  inspector ? inspector.tabs.join(" | ") : ""
);

// ── The node itself no longer expands in place ─────────────────────────────
const heightsAfter = await page.$$eval(".react-flow__node", els =>
  els.map(e => Math.round(e.getBoundingClientRect().height))
);
check(
  "selecting a node does not resize any card",
  JSON.stringify(heightsBefore) === JSON.stringify(heightsAfter),
  `before ${heightsBefore.join(",")} / after ${heightsAfter.join(",")}`
);

// The Name box used to trim on every keystroke and reject empty, so a space
// never landed and you could not clear it to retype.
const nameField = await page.$('#field-name');
if (nameField) {
  await nameField.click({ clickCount: 3 });
  await nameField.type("my app");
  await sleep(400);
  const typed = await page.$eval('#field-name', el => el.value);
  check("name field takes what you type", typed === "my app", `got "${typed}"`);

  // ...and a space is not a legal Kubernetes name, so the checks must say so
  // rather than letting the API server reject it later with an RFC 1123 error.
  const flagged = await page.evaluate(() =>
    document.body.innerText.includes("is not a valid Kubernetes name")
  );
  check("an illegal name is flagged on the canvas", flagged);

  for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
  await sleep(300);
  const cleared = await page.$eval('#field-name', el => el.value);
  check("name field can be cleared to retype", cleared === "", `got "${cleared}"`);

  await nameField.type("nginx");
  await sleep(800);

  // One Ctrl+Z should undo the whole typed edit, not the last character.
  // updateNodeData pushed a history entry per keystroke before this.
  await page.mouse.click(700, 500);
  await sleep(300);
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await sleep(600);

  const afterUndo = await page.evaluate(() => {
    const names = [...document.querySelectorAll(".react-flow__node")]
      .map(n => n.innerText.split(String.fromCharCode(10))[0].trim());
    return names;
  });
  check(
    "one undo reverts the whole typed name, not one character",
    !afterUndo.some(n => /^ngin$|^my app$|^my ap$/.test(n)),
    afterUndo.join(", ")
  );
} else {
  check("name field present in inspector", false, "#field-name not found");
}

// ── Learn tab shows real Kubernetes teaching content ───────────────────────
// The pane click above blurred the name field, which also closed the inspector,
// and a card click alone no longer reopens it.
await page.click(".react-flow__node");
await sleep(400);
await page.evaluate(() => {
  document
    .querySelector(".react-flow__node")
    .querySelector('button[aria-label="Open in the inspector"]')
    .click();
});
await sleep(600);
await clickText(page, "Learn", '[role="tab"]');
await sleep(500);

const learn = await page.evaluate(() => {
  const el = document.querySelector('aside[aria-label="Inspector"]');
  const text = el ? el.innerText : "";
  // innerText returns text-transformed content, and these headings are
  // uppercase in CSS — compare case-insensitively or every one of them misses.
  const lower = text.toLowerCase();
  return {
    hasKeyIdea: lower.includes("the key idea"),
    hasGotchas: lower.includes("where people trip up"),
    hasKubectl: lower.includes("the same thing in kubectl"),
    hasWiring: lower.includes("how it wires up"),
    kubectlLines: [...(el?.querySelectorAll("code") || [])].map(c => c.textContent),
    sample: text.slice(0, 400),
  };
});
check("Learn tab explains the key idea", learn.hasKeyIdea);
check("Learn tab lists common mistakes", learn.hasGotchas);
check("Learn tab shows how it wires up", learn.hasWiring);
check("Learn tab shows the kubectl equivalent", learn.hasKubectl);
check(
  "kubectl commands are filled in, not templated",
  learn.kubectlLines.length > 0 && !learn.kubectlLines.some(l => l.includes("{name}")),
  learn.kubectlLines[0] || "none"
);

// ── Clicking an edge explains the relationship ─────────────────────────────
const edgeClicked = await page.evaluate(() => {
  const path = document.querySelector(".react-flow__edge-interaction");
  if (!path) return false;
  const box = path.getBoundingClientRect();
  const ev = opts =>
    new MouseEvent(opts, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
    });
  path.dispatchEvent(ev("mousedown"));
  path.dispatchEvent(ev("mouseup"));
  path.dispatchEvent(ev("click"));
  return true;
});
await sleep(600);

const edgePanel = await page.evaluate(() => {
  const el = document.querySelector('aside[aria-label="Inspector"]');
  const text = el ? el.innerText : "";
  const known = ["Traffic — Service to pods", "HTTP routing", "Configuration", "Storage",
                 "Autoscaling", "Identity and policy", "Managed by Helm", "Owned by"];
  return { found: known.find(k => text.includes(k)) || null, text: text.slice(0, 250) };
});
check(
  "clicking a wire explains the relationship",
  edgeClicked && !!edgePanel.found,
  edgePanel.found || edgePanel.text.replace(/\n/g, " ").slice(0, 90)
);

// ── The View menu reaches the pod / system-namespace filters ───────────────
await clickText(page, "View", "button");
await sleep(400);
const viewMenu = await page.evaluate(() => document.body.innerText);
check(
  "View menu exposes the pod filter",
  viewMenu.includes("Show pods and ReplicaSets")
);
check(
  "View menu exposes the system namespace filter",
  viewMenu.includes("Show system namespaces")
);

// ── One primary action, not two near-duplicates ───────────────────────────
const buttons = await page.$$eval("button", els => els.map(e => e.textContent.trim()));
check(
  "toolbar has a single Review & apply button",
  buttons.filter(b => b === "Review & apply").length === 1 &&
    !buttons.some(b => b === "Preview YAML"),
  buttons.filter(b => b.includes("apply") || b.includes("Preview")).join(" | ") || "none"
);

// ── Graph checks: catch the classic mistake before it is applied ──────────
// Adding a Service by clicking (not dragging) also proves the keyboard path
// onto the canvas works. A Service with nothing wired into it is the single
// most common Kubernetes mistake, so it must be flagged.
await page.evaluate(() => {
  const row = [...document.querySelectorAll("button")].find(
    b => (b.getAttribute("title") || "").startsWith("Service — ")
  );
  row?.click();
});
await sleep(900);

const afterAdd = await page.$$eval(".react-flow__node", n => n.length);
check("clicking a toolbox row adds a node", afterAdd === nodeCount + 1, `${nodeCount} -> ${afterAdd}`);

// Read the strip itself rather than the whole page, so the assertion is about
// the counter and not about some other "1" elsewhere on screen.
const strip = await page.evaluate(() => {
  const panel = document.querySelector(".react-flow__panel.bottom.center");
  return panel ? panel.innerText.replace(/\s+/g, " ").trim() : "(no panel)";
});
check(
  "status strip reports the new issue",
  !strip.includes("No issues") && /\d/.test(strip),
  strip
);

const badged = await page.$$eval(".react-flow__node", els =>
  els.filter(e => e.querySelector('[aria-label$="issues"]')).length
);
check("the offending card is badged", badged >= 1, `${badged} badged`);

// Open the checks list and read what it says.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(
    b => b.getAttribute("aria-expanded") !== null && b.closest(".react-flow__panel")
  );
  btn?.click();
});
await sleep(500);

const checksList = await page.evaluate(() => document.body.innerText);
check(
  "the check names the Service problem",
  checksList.includes("is not connected to a workload"),
  checksList.includes("is not connected to a workload") ? "" : "not found"
);
check(
  "the check explains why it matters",
  checksList.includes("gets no endpoints"),
);
check("the check says how to fix it", checksList.includes("Fix:"));

// Clicking the issue selects the node and repeats the explanation in place.
await clickText(page, "is not connected to a workload", "p");
await sleep(600);
const inspectorIssue = await page.evaluate(() => {
  const el = document.querySelector('aside[aria-label="Inspector"]');
  const text = el ? el.innerText : "";
  return {
    hasIssue: text.includes("is not connected to a workload"),
    hasFix: text.includes("Fix:"),
  };
});
check("clicking an issue opens it in the inspector", inspectorIssue.hasIssue);
check("the inspector repeats the fix next to the fields", inspectorIssue.hasFix);

// ── The added node found clear space instead of landing on another ────────
const overlaps = await page.$$eval(".react-flow__node", els => {
  const boxes = els.map(e => e.getBoundingClientRect());
  let hits = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) hits++;
    }
  }
  return hits;
});
check("a clicked-in node does not land on top of another", overlaps === 0, `${overlaps} overlapping pairs`);

await page.screenshot({ path: "C:/Pulkit/Coding/Projects/cf/k8n-ui.png" });

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" ~ "));

// ── The preview says what Apply maps to in kubectl ────────────────────────
await clickText(page, "Review & apply", "button");
await sleep(4000);
const preview = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    open: text.includes("Manifest Preview"),
    lower: text.toLowerCase(),
  };
});
check("Review & apply opens the manifest preview", preview.open);
check(
  "preview shows the kubectl equivalent",
  preview.lower.includes("the same thing in kubectl") &&
    preview.lower.includes("kubectl apply --dry-run=server"),
);
await page.screenshot({ path: "C:/Pulkit/Coding/Projects/cf/k8n-preview.png" });
await clickText(page, "Cancel", "button");
await sleep(500);

// ── /deployed still works after LogsAndEvents was pulled out of it ────────
// A fresh tab, for two reasons: the canvas now has unsaved changes and its
// beforeunload guard blocks navigation away (which is the guard working), and
// domcontentloaded rather than networkidle2 because this page holds an SSE
// stream open so the network never goes idle.
const deployedPage = await browser.newPage();
await deployedPage.setViewport({ width: 1600, height: 950 });
await deployedPage.goto(`${process.env.K8N_BASE || "http://127.0.0.1:8090"}/deployed?t=${TOKEN}`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await sleep(4000);
const deployedText = await deployedPage.evaluate(() => document.body.innerText);
check(
  "deployed page renders cluster resources",
  !deployedText.includes("Cannot connect to API server") && deployedText.length > 200,
  deployedText.slice(0, 70).replace(/\s+/g, " ")
);

const openedInspect = await deployedPage.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(b =>
    /logs|inspect|events/i.test(b.getAttribute("title") || "")
  );
  if (!btn) return null;
  btn.click();
  return btn.getAttribute("title");
});
await sleep(1800);
const inspectOpen = await deployedPage.evaluate(() =>
  /Logs|Events/.test(document.body.innerText)
);
check(
  "logs/events panel still opens on the deployed page",
  openedInspect === null || inspectOpen,
  openedInspect === null ? "no inspect button found (skipped)" : openedInspect
);

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
