"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CheckCircle2, Circle, Copy, Download, Loader2, RefreshCw } from "lucide-react";
import Logo from "../../components/Logo";
import { fetchHealth } from "../../lib/api";
import { getEngine } from "../../lib/session";

/**
 * From nothing to k8n on your own cluster, in the app itself: Docker and a
 * local Kubernetes, the engine, and pairing this page with it. Each command has
 * a copy button, and the last step checks for the engine live, so you can see
 * when you are done rather than guess.
 */

type OS = "windows" | "mac" | "linux";

const LATEST = "https://github.com/pulk17/k8n/releases/latest/download";

const DOWNLOADS: Record<OS, { label: string; file: string }[]> = {
  windows: [{ label: "Windows (x64)", file: "k8n-windows-amd64.exe" }],
  mac: [
    { label: "Apple Silicon (M1–M4)", file: "k8n-darwin-arm64" },
    { label: "Intel Mac", file: "k8n-darwin-amd64" },
  ],
  linux: [
    { label: "Linux x86-64", file: "k8n-linux-amd64" },
    { label: "Linux ARM64", file: "k8n-linux-arm64" },
  ],
};

interface Step {
  text: string;
  commands?: string[];
}

const CLUSTER: Record<OS, Step[]> = {
  windows: [
    { text: "Install Docker Desktop — from docker.com/products/docker-desktop, keeping “Use WSL 2” ticked, or with winget:", commands: ["winget install Docker.DockerDesktop"] },
    { text: "Restart if asked, open Docker Desktop and wait for “Engine running”." },
    { text: "Settings → Kubernetes → Enable Kubernetes → Apply & restart. The first start takes a minute or three." },
    { text: "kubectl comes with it. In a new terminal, every node should say Ready:", commands: ["kubectl get nodes"] },
  ],
  mac: [
    { text: "Install Docker Desktop — from docker.com/products/docker-desktop (pick Apple Silicon or Intel), or with Homebrew:", commands: ["brew install --cask docker"] },
    { text: "Open Docker from Applications and let it finish starting." },
    { text: "Settings → Kubernetes → Enable Kubernetes → Apply & restart." },
    { text: "Check it — every node should say Ready:", commands: ["kubectl get nodes"] },
  ],
  linux: [
    { text: "Install Docker Engine, then log out and back in so docker works without sudo:", commands: ["curl -fsSL https://get.docker.com | sh", "sudo usermod -aG docker $USER"] },
    {
      text: "Install kubectl (use arm64 in place of amd64 on ARM):",
      commands: [
        'curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"',
        "sudo install -m 0755 kubectl /usr/local/bin/kubectl",
      ],
    },
    {
      text: "Install kind, which runs Kubernetes inside Docker (the current version is on kind.sigs.k8s.io):",
      commands: ["curl -Lo kind https://kind.sigs.k8s.io/dl/v0.30.0/kind-linux-amd64", "sudo install -m 0755 kind /usr/local/bin/kind"],
    },
    { text: "Create a cluster and check it:", commands: ["kind create cluster --name k8n", "kubectl get nodes"] },
  ],
};

const RUN: Record<OS, Step[]> = {
  windows: [
    { text: "Double-click it. Windows SmartScreen will warn that it is unsigned: More info → Run anyway. It opens your browser by itself, already paired. From a terminal instead:", commands: [".\\k8n-windows-amd64.exe"] },
  ],
  mac: [
    { text: "macOS blocks unsigned downloads until you clear the flag. Then run it (use k8n-darwin-amd64 on an Intel Mac):", commands: ["chmod +x k8n-darwin-arm64 && xattr -d com.apple.quarantine k8n-darwin-arm64", "./k8n-darwin-arm64"] },
  ],
  linux: [{ text: "Make it executable and run it:", commands: ["chmod +x k8n-linux-amd64 && ./k8n-linux-amd64"] }],
};

const TROUBLE: [string, string][] = [
  ["“k8n runs on your machine” instead of the app", "The engine is not running, or runs on another port. Start it, or give the address it printed on that screen."],
  ["You clicked Block on the browser's prompt", "Click the icon left of the address bar → Site settings → allow local network access (called “Apps on this device” in newer Chrome), then reload."],
  ["“Not paired with this k8n”", "Its token changed. Open the “Or use it from the web” link it prints again."],
  ["Something else uses port 8080", "k8n moves to the next free port by itself and says so; the links it prints use that port. To pick one yourself: --port 9000."],
  ["No cluster, or no contexts to pick", "Make sure kubectl get nodes works in a terminal first. If your kubeconfig lives elsewhere, set KUBECONFIG before starting k8n."],
  ["The cluster is gone after a restart", "Start Docker Desktop and wait for Kubernetes to go green. If it never does: Settings → Kubernetes → Reset Kubernetes Cluster (this deletes what was on it)."],
  ["Safari", "Safari will not let a website reach a program on your computer. Use Chrome, Edge or Firefox — or the first link k8n prints, which serves this same app from your machine."],
];

const noChange = () => () => {};

function detectOS(): OS {
  if (typeof navigator === "undefined") return "windows";
  const p = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (p.includes("mac")) return "mac";
  if (p.includes("linux") || p.includes("x11")) return "linux";
  return "windows";
}

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group mt-2 flex items-center gap-2 rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs text-green-300">{text}</code>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        aria-label="Copy command"
        title="Copy"
        className="flex-shrink-0 rounded p-1 text-gray-500 hover:bg-neutral-800 hover:text-gray-200"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((step, i) => (
        <li key={i} className="text-sm leading-relaxed text-gray-300">
          {step.text}
          {step.commands?.map(c => <Command key={c} text={c} />)}
        </li>
      ))}
    </ol>
  );
}

function Section({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-6">
      <h2 className="mb-4 flex items-center gap-3 text-lg font-semibold text-gray-100">
        {done ? (
          <CheckCircle2 className="h-6 w-6 text-green-500" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{n}</span>
        )}
        {title}
      </h2>
      {children}
    </section>
  );
}

type EngineState = "checking" | "found" | "missing";

export default function SetupPage() {
  // Detected after the page loads (the static render cannot know), until you pick a tab.
  const detected = useSyncExternalStore(noChange, detectOS, () => "windows" as OS);
  const [picked, setOs] = useState<OS | null>(null);
  const os = picked ?? detected;
  const [engine, setEngineState] = useState<EngineState>("checking");
  const [cluster, setCluster] = useState("");
  const [attempt, setAttempt] = useState(0);

  // Looks for the engine now, and again whenever you ask — so step 4 turns
  // green by itself once k8n is running and paired.
  useEffect(() => {
    let cancelled = false;
    fetchHealth()
      .then(h => {
        if (cancelled) return;
        setEngineState("found");
        setCluster(h.kubernetes === "connected" ? h.context ?? "connected" : "");
      })
      .catch(() => !cancelled && setEngineState("missing"));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const hosted = useSyncExternalStore(noChange, () => Boolean(getEngine()), () => true);
  const engineAddress = useSyncExternalStore(noChange, getEngine, () => "");

  return (
    <div className="h-screen overflow-y-auto bg-neutral-950">
      <div className="mx-auto max-w-3xl space-y-5 p-8 pb-24">
        <div>
          <Link href="/canvas" className="mb-5 inline-flex items-center gap-2 text-sm text-blue-400 hover:underline">
            <ArrowLeft className="h-4 w-4" />
            Back to the canvas
          </Link>
          <div className="flex items-center gap-4">
            <Logo className="h-12 w-12" />
            <div>
              <h1 className="text-2xl font-bold text-gray-100">Set up k8n</h1>
              <p className="text-sm text-gray-400">
                About ten minutes, once. k8n runs on your own machine, next to your cluster, so your credentials never
                leave it.
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1" role="tablist">
          {(["windows", "mac", "linux"] as OS[]).map(o => (
            <button
              key={o}
              role="tab"
              aria-selected={os === o}
              onClick={() => setOs(o)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                os === o ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-neutral-800 hover:text-gray-200"
              }`}
            >
              {o === "windows" ? "Windows" : o === "mac" ? "macOS" : "Linux"}
            </button>
          ))}
        </div>

        <Section n={1} title="A Kubernetes cluster on your computer" done={Boolean(cluster)}>
          {cluster ? (
            <p className="mb-3 text-sm text-green-400">
              Found one: <span className="font-mono">{cluster}</span>. You can skip this step.
            </p>
          ) : (
            <p className="mb-3 text-sm text-gray-400">
              Already have one — kind, minikube, k3d, a cloud cluster in your kubeconfig? Skip to step 2.
            </p>
          )}
          <Steps steps={CLUSTER[os]} />
        </Section>

        <Section n={2} title="Download k8n" done={engine === "found"}>
          <p className="mb-3 text-sm text-gray-400">One file. No installer, no Node, no Docker image.</p>
          <div className="flex flex-wrap gap-2">
            {DOWNLOADS[os].map(d => (
              <a
                key={d.file}
                href={`${LATEST}/${d.file}`}
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                <Download className="h-4 w-4" />
                {d.label}
              </a>
            ))}
            <a
              href="https://github.com/pulk17/k8n/releases/latest"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md border border-neutral-700 px-4 py-2 text-sm text-gray-300 hover:bg-neutral-800"
            >
              All downloads and checksums
            </a>
          </div>
        </Section>

        <Section n={3} title="Run it" done={engine === "found"}>
          <Steps steps={RUN[os]} />
          <p className="mt-4 text-sm text-gray-400">Keep that terminal open — closing it stops k8n. It prints two links:</p>
          <pre className="mt-2 overflow-x-auto rounded border border-neutral-800 bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed text-gray-400">
{`  Open this link to pair your browser:
    http://127.0.0.1:8080/?t=…

  Or use it from the web:
    https://k8n.pages.dev/?engine=http%3A%2F%2F127.0.0.1%3A8080&t=…`}
          </pre>
        </Section>

        <Section n={4} title="Connect this page to it" done={engine === "found"}>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-gray-300">
            <li>
              Open the <strong>second</strong> link — “Or use it from the web”
              {hosted ? "" : " (or the first; this page is already served by k8n)"}.
            </li>
            <li>
              If your browser asks whether this site may reach <em>apps and services on this device</em>, choose{" "}
              <strong>Allow</strong>. That is this page asking to talk to k8n.
            </li>
            <li>That is all: it remembers the engine. Next time, start k8n and open this site.</li>
          </ol>

          <div
            className={`mt-4 flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm ${
              engine === "found" ? "border-green-800 bg-green-950/30 text-green-300" : "border-neutral-800 bg-neutral-950 text-gray-400"
            }`}
          >
            <span className="flex items-center gap-2">
              {engine === "checking" && <Loader2 className="h-4 w-4 animate-spin" />}
              {engine === "found" && <CheckCircle2 className="h-4 w-4" />}
              {engine === "missing" && <Circle className="h-4 w-4" />}
              {engine === "found"
                ? cluster
                  ? `Connected to k8n, on cluster ${cluster}.`
                  : "Connected to k8n. It has no cluster yet — see step 1."
                : engine === "checking"
                  ? "Looking for k8n…"
                  : `No k8n found${engineAddress ? ` at ${engineAddress}` : ""} yet.`}
            </span>
            {engine === "found" ? (
              <Link href="/canvas" className="rounded bg-green-700 px-3 py-1 text-xs font-medium text-white hover:bg-green-600">
                Open the canvas
              </Link>
            ) : (
              <button
                onClick={() => {
                  setEngineState("checking");
                  setAttempt(a => a + 1);
                }}
                className="flex items-center gap-1 rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
              >
                <RefreshCw className="h-3 w-3" /> Check again
              </button>
            )}
          </div>
        </Section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="mb-3 text-lg font-semibold text-gray-100">Then</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-gray-300">
            <li>New to Kubernetes? Press Ctrl+K on the canvas and choose “Start the guided tour”.</li>
            <li>What is already running is under Deployed, grouped by application.</li>
            <li>The assistant is optional: open it, pick a provider and paste a key. The key stays on your machine.</li>
          </ul>
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="mb-3 text-lg font-semibold text-gray-100">If something is not right</h2>
          <dl className="divide-y divide-neutral-800">
            {TROUBLE.map(([problem, fix]) => (
              <div key={problem} className="grid gap-1 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4">
                <dt className="text-sm font-medium text-gray-200">{problem}</dt>
                <dd className="text-sm leading-relaxed text-gray-400">{fix}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
