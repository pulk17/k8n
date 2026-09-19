import { describe, expect, it } from "vitest";
import { generateEdges } from "../edges";
import { inputsFor, outputsFor } from "../connections";
import type { K8sResource } from "../api";

const r = (kind: string, name: string, extra: Partial<K8sResource> = {}): K8sResource => ({
  kind,
  name,
  namespace: "default",
  labels: {},
  status: "Active",
  uid: `${kind}-${name}`,
  ...extra,
});

// Everything import can wire together, as the grafana chart produced it.
const cluster = [
  r("Service", "grafana", { selector: { app: "grafana" } }),
  r("Ingress", "front", { backends: ["grafana"] }),
  r("ConfigMap", "grafana"),
  r("Secret", "grafana"),
  r("PersistentVolumeClaim", "data"),
  r("ServiceAccount", "grafana"),
  r("HorizontalPodAutoscaler", "grafana", { scaleTargetKind: "Deployment", scaleTargetName: "grafana" }),
  r("Deployment", "grafana", {
    labels: { app: "grafana" },
    selector: { app: "grafana" },
    configMapRefs: ["grafana"],
    secretRefs: ["grafana"],
    pvcRefs: ["data"],
    serviceAccountName: "grafana",
  }),
  r("ReplicaSet", "grafana-abc", { ownerReferences: ["grafana"], labels: { app: "grafana" } }),
];

describe("imported edges", () => {
  const edges = generateEdges(cluster);
  const kindOf = (uid: string) => cluster.find(x => x.uid === uid)!.kind;

  it("wires every real reference", () => {
    expect(edges.length).toBeGreaterThanOrEqual(7);
  });

  const drawable = edges.filter(e => e.data.edgeType !== "ownership");

  it.each(drawable.map(e => [`${kindOf(e.source)} -> ${kindOf(e.target)}`, e] as const))(
    "%s lands on its own typed sockets",
    (_, e) => {
      const type = e.data.edgeType;
      expect(e.sourceHandle).toBe(`output-${type}`);
      expect(e.targetHandle).toBe(`input-${type}`);
      // The sockets have to exist on the cards, or React Flow drops the wire.
      expect(outputsFor(kindOf(e.source)).map(h => h.type)).toContain(type);
      expect(inputsFor(kindOf(e.target)).map(h => h.type)).toContain(type);
    }
  );

  it("does not pile different kinds of wire onto one socket", () => {
    const into = edges.filter(e => kindOf(e.target) === "Deployment").map(e => e.targetHandle);
    expect(new Set(into).size).toBeGreaterThan(1);
  });
});
