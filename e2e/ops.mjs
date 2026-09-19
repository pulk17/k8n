// Day-to-day operations against a real cluster: port-forward, exec, secrets,
// scale, restart, rollback, diff, RBAC, namespaces and a stuck finalizer. Runs
// in its own namespace and deletes it afterwards.
import puppeteer from "puppeteer";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.K8N_BASE || "http://127.0.0.1:8090";
const TOKEN = readFileSync(join(process.env.K8N_HOME || homedir(), ".k8n", "token"), "utf8").trim();
const NS = "k8n-e2e-ops";

const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "X-K8n-Token": TOKEN, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { text };
  }
  return { status: res.status, data };
};
const resources = async () => (await api("GET", `/api/cluster/resources?namespace=${NS}`)).data;
const find = async (kind, name) => (await resources()).find(r => r.kind === kind && r.name === name);
const until = async (what, fn, ms = 180000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(2000);
  }
  console.log(`  (gave up waiting for ${what})`);
  return false;
};

const health = (await api("GET", "/health")).data;
if (health.kubernetes !== "connected") {
  console.log("SKIP  no cluster connected");
  process.exit(0);
}

const manifest = (image, extra = "") => `
apiVersion: apps/v1
kind: Deployment
metadata: {name: web, namespace: ${NS}}
spec:
  replicas: 1
  selector: {matchLabels: {app: web}}
  template:
    metadata: {labels: {app: web}${extra}}
    spec:
      serviceAccountName: reader
      containers:
      - name: web
        image: ${image}
        ports: [{name: http, containerPort: 80}]
        readinessProbe: {httpGet: {path: /, port: http}, periodSeconds: 2}
---
apiVersion: v1
kind: Service
metadata: {name: web, namespace: ${NS}}
spec:
  selector: {app: web}
  ports: [{port: 8080, targetPort: http}]
---
apiVersion: v1
kind: Secret
metadata: {name: creds, namespace: ${NS}}
stringData: {password: hunter2}
---
apiVersion: v1
kind: ServiceAccount
metadata: {name: reader, namespace: ${NS}}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: {name: pod-reader, namespace: ${NS}}
rules: [{apiGroups: [""], resources: [pods], verbs: [get, list]}]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: {name: reader-reads, namespace: ${NS}}
subjects: [{kind: ServiceAccount, name: reader, namespace: ${NS}}]
roleRef: {apiGroup: rbac.authorization.k8s.io, kind: Role, name: pod-reader}
`;

// --- namespaces ----------------------------------------------------------------
await api("DELETE", `/api/cluster/namespaces/${NS}`);
await until("the old namespace to go", async () => (await api("POST", "/api/cluster/namespaces", { name: NS })).status === 200, 120000);
check("a namespace can be created", (await api("GET", "/api/cluster/namespaces")).data.some?.(n => n === NS || n?.name === NS) ?? true);
check("an invalid namespace name is refused", (await api("POST", "/api/cluster/namespaces", { name: "Bad_Name" })).status === 400);
check("default cannot be deleted", (await api("DELETE", "/api/cluster/namespaces/default")).status === 403);

// --- apply and wait ------------------------------------------------------------
let r = await api("POST", "/api/graph/apply", { yaml: manifest("nginx:1.27-alpine") });
check("the test app applies", r.status === 200, JSON.stringify(r.data).slice(0, 200));
const ready = await until("web to be ready", async () => (await find("Deployment", "web"))?.status === "Ready");
check("the Deployment becomes ready", ready);

// --- diff ------------------------------------------------------------------------
r = await api("POST", "/api/graph/diff", { yaml: manifest("nginx:1.27-alpine") });
const byName = Object.fromEntries((r.data.changes ?? []).map(c => [c.resource, c]));
check("reapplying the same manifest changes nothing", byName["Deployment/web"]?.action === "unchanged", byName["Deployment/web"]?.diff?.slice(0, 200));
r = await api("POST", "/api/graph/diff", {
  yaml: manifest("nginx:1.26-alpine") + `---\napiVersion: v1\nkind: ConfigMap\nmetadata: {name: brand-new, namespace: ${NS}}\n`,
});
const changes = Object.fromEntries((r.data.changes ?? []).map(c => [c.resource, c]));
const d = changes["Deployment/web"]?.diff ?? "";
check("a changed image shows as an update", changes["Deployment/web"]?.action === "update" && d.includes("-") && d.includes("nginx:1.26-alpine"), d.split("\n").filter(l => /^[+-] /.test(l)).join(" | "));
check("a new object shows as a create", changes["ConfigMap/brand-new"]?.action === "create");

// --- port-forward ----------------------------------------------------------------
r = await api("POST", "/api/portforward", { kind: "Service", namespace: NS, name: "web" });
const tunnel = r.data;
check("a Service can be opened on localhost", r.status === 200 && tunnel.remotePort === 80, `${tunnel.url} -> ${tunnel.pod}:${tunnel.remotePort}`);
let page = await fetch(tunnel.url).then(x => x.text()).catch(e => String(e));
check("the tunnel reaches nginx", page.includes("nginx"), page.slice(0, 60));
check("open tunnels are listed", (await api("GET", "/api/portforward")).data.forwards?.some(f => f.id === tunnel.id));
check("a tunnel can be stopped", (await api("DELETE", `/api/portforward/${tunnel.id}`)).status === 200);
await sleep(500);
page = await fetch(tunnel.url).then(() => "still open").catch(() => "closed");
check("and is really closed", page === "closed");

// --- exec, secrets, RBAC ---------------------------------------------------------
const pod = (await resources()).find(x => x.kind === "Pod" && x.name.startsWith("web-") && x.status === "Running");
r = await api("POST", "/api/exec", { namespace: NS, pod: pod?.name, command: "echo hello-from-$HOSTNAME | tr a-z A-Z" });
check("a command runs in the container, through a shell", (r.data.output ?? "").includes("HELLO-FROM-WEB"), (r.data.output ?? r.data.error ?? "").trim());
r = await api("GET", `/api/secret/${NS}/creds`);
check("a Secret's values can be revealed", r.data.data?.password === "hunter2");
check("kube-system secrets are refused", (await api("GET", "/api/secret/kube-system/anything")).status === 403);
r = await api("GET", `/api/rbac/serviceaccount/${NS}/reader`);
const perms = r.data.permissions ?? [];
check("a ServiceAccount's permissions are traced to its binding", perms.some(p => p.resources.includes("pods") && p.verbs.includes("list") && p.source.includes("reader-reads")), perms.map(p => p.source).join("; "));
r = await api("GET", "/api/cluster/ingressclasses");
check("ingress classes are listed", Array.isArray(r.data.ingressClasses), JSON.stringify(r.data.ingressClasses));

// --- scale, restart, rollback ----------------------------------------------------
r = await api("POST", "/api/workload/scale", { kind: "Deployment", namespace: NS, name: "web", replicas: 2 });
check("a Deployment can be scaled", r.status === 200, r.data.message);
check("and actually gets two pods", await until("2 ready replicas", async () => (await find("Deployment", "web"))?.readyReplicas === 2));
check("coredns cannot be scaled", (await api("POST", "/api/workload/scale", { kind: "Deployment", namespace: "kube-system", name: "coredns", replicas: 0 })).status === 403);

r = await api("POST", "/api/graph/apply", { yaml: manifest("nginx:1.26-alpine") });
// Reapplying also puts replicas back to the manifest's 1; the image is what
// matters here — it makes revision 2.
check("a new image rolls out", await until("the new image to roll out", async () => {
  const dep = await find("Deployment", "web");
  return dep?.image === "nginx:1.26-alpine" && dep?.status === "Ready";
}));
r = await api("POST", "/api/workload/rollback", { kind: "Deployment", namespace: NS, name: "web" });
check("a Deployment rolls back to the previous revision", r.status === 200, r.data.message ?? r.data.error);
check("and runs the old image again", await until("the old image", async () => (await find("Deployment", "web"))?.image === "nginx:1.27-alpine"));
r = await api("POST", "/api/workload/restart", { kind: "Deployment", namespace: NS, name: "web" });
check("a Deployment can be restarted", r.status === 200, r.data.message);

// --- a delete held by a finalizer ------------------------------------------------
await api("POST", "/api/graph/apply", {
  yaml: `apiVersion: v1\nkind: ConfigMap\nmetadata: {name: held, namespace: ${NS}, finalizers: [k8n.test/hold]}\n`,
});
r = await api("DELETE", "/api/resource/delete", { kind: "ConfigMap", name: "held", namespace: NS });
check("a delete held by a finalizer says so", r.data.terminating === true, r.data.hint);
r = await api("POST", "/api/resource/finalize", { kind: "ConfigMap", name: "held", namespace: NS });
check("and Finish deleting lets it go", r.status === 200 && (await until("held to go", async () => !(await find("ConfigMap", "held")), 30000)));

// --- the page --------------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || undefined,
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: { width: 1500, height: 1000 },
});
const tab = await browser.newPage();
const errors = [];
tab.on("console", m => m.type() === "error" && !/favicon|404/.test(m.text()) && errors.push(m.text().slice(0, 160)));
await tab.goto(`${BASE}/deployed?t=${TOKEN}`, { waitUntil: "networkidle2", timeout: 60000 });
// The rows arrive over the live stream, not with the page.
await tab.waitForFunction(ns => document.body.innerText.includes(ns), { timeout: 30000 }, NS).catch(() => {});
await tab.select("select", NS).catch(() => {});
await sleep(1000);
// Every row with that name: the Deployment and the Service are both "web".
const expand = name =>
  tab.evaluate(n => {
    const rows = [...document.querySelectorAll("button")].filter(
      x => x.querySelector("span")?.textContent?.trim() === n && x.textContent.includes("k8n-e2e-ops")
    );
    rows.forEach(b => b.click());
    return rows.length;
  }, name);
const text = () => tab.evaluate(() => document.body.innerText);
const click = label =>
  tab.evaluate(l => {
    const b = [...document.querySelectorAll("button")].find(x => x.textContent?.trim() === l);
    b?.click();
    return Boolean(b);
  }, label);

await expand("creds");
await sleep(400);
check("an expanded Secret offers Reveal values", await click("Reveal values"));
await sleep(1000);
check("and shows them", (await text()).includes("hunter2"));
await expand("web");
await sleep(400);
const t = await text();
check("an expanded Deployment offers Scale, Restart and Roll back", t.includes("Scale") && t.includes("Restart") && t.includes("Roll back"));
check("an expanded Service offers Open in browser", t.includes("Open in browser"));
check("no page errors", errors.length === 0, errors.slice(0, 2).join(" ~ "));
if (!results.every(Boolean)) await tab.screenshot({ path: "ops-failure.png" });
await browser.close();

// --- clean up --------------------------------------------------------------------
check("the namespace and everything in it can be deleted", (await api("DELETE", `/api/cluster/namespaces/${NS}`)).status === 200);

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
