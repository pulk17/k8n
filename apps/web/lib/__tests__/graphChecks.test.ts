import { describe, expect, it } from "vitest";
import type { Node } from "reactflow";
import { checkGraph } from "../graphChecks";
import { NodeData, makeEdge, makeNode } from "../graph";
import { templateToGraph, templates } from "../templates";
import { isValidConnection } from "../connections";

const titles = (issues: { title: string }[]) => issues.map(i => i.title);

describe("graph checks", () => {
  it("asks for limits and a health check on a bare server", () => {
    const web = makeNode("w", "Deployment", "web", "default", { image: "nginx", containerPort: 80 });
    const found = titles(checkGraph([web], []));
    expect(found).toContain("web has no resource limits");
    expect(found).toContain("web has no health check");
  });

  it("is quiet once they are set", () => {
    const web = makeNode("w", "Deployment", "web", "default", {
      image: "nginx",
      containerPort: 80,
      memoryLimit: "256Mi",
      healthPath: "/",
    });
    const found = titles(checkGraph([web], []));
    expect(found).not.toContain("web has no resource limits");
    expect(found).not.toContain("web has no health check");
  });

  it("does not ask a Job for a health check", () => {
    const job = makeNode("j", "Job", "migrate", "default", { image: "busybox", containerPort: 80 });
    expect(titles(checkGraph([job], []))).not.toContain("migrate has no health check");
  });

  it("rejects names the API server would reject", () => {
    const bad = makeNode("x", "ConfigMap", "My Config", "default");
    expect(titles(checkGraph([bad], []))).toContain("My Config is not a valid Kubernetes name");
  });

  it("leaves imported and chart-rendered resources alone", () => {
    const live = makeNode("l", "Deployment", "Live_One", "default");
    live.data.origin = "cluster";
    const chart = makeNode("c", "Deployment", "Chart_One", "default");
    chart.data.origin = "helm";
    expect(checkGraph([live, chart], [])).toEqual([]);
  });

  it("notices a Service wired to nothing", () => {
    const svc = makeNode("s", "Service", "web", "default");
    const deploy = makeNode("d", "Deployment", "web", "default", { image: "nginx", containerPort: 80 });
    expect(titles(checkGraph([svc], []))).toContain("web is not connected to a workload");
    expect(titles(checkGraph([svc, deploy], [makeEdge(svc, deploy)]))).not.toContain(
      "web is not connected to a workload"
    );
  });
});

describe("templates", () => {
  it.each(templates.map(t => [t.name, t] as const))("%s builds a valid graph with no warnings", (_, template) => {
    const { nodes, edges } = templateToGraph(template) as { nodes: Node<NodeData>[]; edges: typeof templateToGraph extends (...a: never[]) => { edges: infer E } ? E : never };
    expect(nodes.length).toBeGreaterThan(0);
    for (const e of edges) {
      const s = nodes.find(n => n.id === e.source)!;
      const t = nodes.find(n => n.id === e.target)!;
      expect(isValidConnection(s.data.kind, t.data.kind), `${s.data.kind} -> ${t.data.kind}`).toBe(true);
    }
    const warnings = checkGraph(nodes, edges).filter(i => i.level === "warning");
    expect(warnings.map(w => w.title)).toEqual([]);
  });
});
