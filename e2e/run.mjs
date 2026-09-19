// Runs every browser suite against a k8n of its own.
//
// The instance gets a throwaway home directory, so its pairing token, saved
// workflows and AI settings — and the credential-store entry for the AI key,
// which is filed under the config path — never touch the real ones. It still
// uses your kubeconfig: the suites need a cluster, and skip what needs one when
// there is none.
//
//   node run.mjs                 every suite
//   node run.mjs ops ui          just these
//   K8N_BIN=path/to/k8n node run.mjs
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..");
const PORT = 8091;
const STATIC_PORT = 8099;
const SUITES = ["pair", "ui", "learn", "provider", "aierror", "aisetup", "ops", "helm", "offline"];

const exe = process.platform === "win32" ? ".exe" : "";
const arch = process.arch === "x64" ? "amd64" : process.arch;
const bin = process.env.K8N_BIN || join(root, "dist", `k8n-${process.platform === "win32" ? "windows" : process.platform}-${arch}${exe}`);
if (!existsSync(bin)) {
  console.error(`No k8n binary at ${bin}. Build one (see README) or set K8N_BIN.`);
  process.exit(2);
}

const home = mkdtempSync(join(tmpdir(), "k8n-e2e-"));
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  KUBECONFIG: process.env.KUBECONFIG || join(homedir(), ".kube", "config"),
};

// --- the engine ------------------------------------------------------------------
const engine = spawn(bin, ["--port", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
let engineLog = "";
engine.stdout.on("data", d => (engineLog += d));
engine.stderr.on("data", d => (engineLog += d));

const base = `http://127.0.0.1:${PORT}`;
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  up = await fetch(`${base}/health`).then(r => r.ok).catch(() => false);
  if (!up) await new Promise(r => setTimeout(r, 500));
}
if (!up) {
  console.error("k8n did not start:\n" + engineLog);
  engine.kill();
  process.exit(2);
}

// --- the hosted page, with no engine behind it (the offline suite) -----------------
const out = join(root, "apps", "web", "out");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".txt": "text/plain", ".woff2": "font/woff2" };
const site = createServer((req, res) => {
  let path = join(out, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
  // Next asks for /x/__next.x.__PAGE__.txt; the export wrote /x/__next.x/__PAGE__.txt.
  if (!existsSync(path)) path = path.replace(/__next\.([^\/]+)\.txt$/, (_, rest) => `__next.${rest.split(".").join("/")}.txt`);
  if (!existsSync(path)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
  createReadStream(path).pipe(res);
}).listen(STATIC_PORT, "127.0.0.1");

// --- the suites --------------------------------------------------------------------
const chosen = process.argv.slice(2).length ? process.argv.slice(2) : SUITES;
const summary = [];
for (const name of chosen) {
  console.log(`\n=== ${name}`);
  const { code, output } = await new Promise(resolve => {
    const child = spawn(process.execPath, [join(here, `${name}.mjs`)], {
      // The suites keep the real home — Chrome will not start with a borrowed
      // one — and find the engine's token through K8N_HOME instead.
      env: { ...process.env, K8N_BASE: base, K8N_HOME: home, K8N_STATIC: `http://127.0.0.1:${STATIC_PORT}` },
    });
    let output = "";
    const echo = d => {
      output += d;
      process.stdout.write(d);
    };
    child.stdout.on("data", echo);
    child.stderr.on("data", echo);
    child.on("close", code => resolve({ code, output }));
  });
  const failed = (output.match(/^FAIL /gm) || []).length;
  const tally = (output.match(/(\d+)\/(\d+) passed/) || [])[0] || (output.includes("SKIP") ? "skipped" : "no tally");
  summary.push({ name, ok: code === 0 && failed === 0, tally, failed });
}

engine.kill();
site.close();
try {
  rmSync(home, { recursive: true, force: true });
} catch {
  // Windows sometimes holds a file a moment after the process exits.
}

console.log("\n=== summary");
for (const s of summary) console.log(`${s.ok ? "ok  " : "FAIL"}  ${s.name.padEnd(10)} ${s.tally}`);
process.exit(summary.every(s => s.ok) ? 0 : 1);
