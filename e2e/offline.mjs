// The hosted-page case: static files, no engine anywhere behind them.
import puppeteer from "puppeteer";

const BASE = process.env.K8N_STATIC || "http://127.0.0.1:8099";
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clickButton = (page, text) =>
  page.evaluate(t => {
    const btn = [...document.querySelectorAll("button")].find(b => (b.textContent || "").includes(t));
    if (!btn) return false;
    btn.click();
    return true;
  }, text);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || undefined,
  headless: "new",
  args: ["--no-sandbox"], // CI runners have no user namespace sandbox
  defaultViewport: { width: 1500, height: 1000 },
});
const page = await browser.newPage();
await page.goto(`${BASE}/canvas/`, { waitUntil: "networkidle2", timeout: 60000 });
await sleep(4000);

// A first visit asks how much to explain; answer it, then take a graph to look
// at — which is what a visitor to a hosted copy would do.
await clickButton(page, "Just open the canvas");
await sleep(1200);
await clickButton(page, "Nginx starter");
await sleep(2000);

let text = await page.evaluate(() => document.body.innerText);
check("a page with no engine says so", /No cluster connected/i.test(text));
check("it points at the download", /Get it/i.test(text));
check("it does not tell a visitor to run a Go command", !/go run main/i.test(text));

const nodes = await page.$$eval(".react-flow__node", n => n.length);
check("the canvas still works with no engine", nodes > 3, `${nodes} cards`);

// The teaching half must work with nothing running.
await page.evaluate(() => {
  document
    .querySelector(".react-flow__node")
    .querySelector('button[aria-label="Open in the inspector"]')
    .click();
});
await sleep(800);
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find(t =>
    t.textContent.includes("Learn")
  );
  tab?.click();
});
await sleep(700);
const dock = await page.evaluate(
  () => document.querySelector('aside[aria-label="Inspector"]')?.innerText || ""
);
check("the Learn tab still teaches", /key idea/i.test(dock), `${dock.length} chars`);
check("kubectl is still shown", /kubectl/i.test(dock));

// "No issues", or the counts button (its words are in its label).
const strip = await page.evaluate(
  () => document.body.innerText + " " + [...document.querySelectorAll("button[aria-expanded]")].map(b => b.getAttribute("aria-label")).join(" ")
);
check(
  "the graph checks still run",
  /issue|No issues/i.test(strip),
  strip.match(/\d+ nodes[^\n]*/)?.[0] || ""
);

// Compiling should explain itself rather than throwing a network error.
await clickButton(page, "Review & apply");
await sleep(2000);
text = await page.evaluate(() => document.body.innerText);
check(
  "compiling says it needs the local engine",
  /needs the k8n engine/i.test(text),
  text.match(/.{0,30}needs the k8n engine.{0,30}/)?.[0]?.replace(/\s+/g, " ") || ""
);

// And the assistant says where it actually lives.
await clickButton(page, "Assistant");
await sleep(900);
text = await page.evaluate(() => document.body.innerText);
check("the assistant says where it lives", /runs inside the k8n on your machine/i.test(text));

await page.screenshot({ path: "k8n-offline.png" });
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
