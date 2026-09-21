import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, fetchResources: vi.fn(), fetchHelmReleases: vi.fn(), fetchNamespaces: vi.fn() };
});

import { fetchHelmReleases, fetchResources } from "../../lib/api";
import { useCanvasStore } from "../canvasStore";

const resource = (over: Partial<Record<string, unknown>>) => ({
  kind: "Service",
  name: "grafana",
  namespace: "default",
  uid: Math.random().toString(),
  status: "Active",
  stack: "grafana",
  stackSource: "helm",
  ...over,
});

const CLUSTER = [
  resource({ kind: "Service", name: "grafana" }),
  resource({ kind: "Deployment", name: "grafana" }),
  resource({ kind: "Secret", name: "grafana" }),
  resource({ kind: "Secret", name: "sh.helm.release.v1.grafana.v2" }),
  resource({ kind: "Service", name: "other", stack: "shop", stackSource: "label" }),
];

describe("importing one stack onto the canvas", () => {
  beforeEach(() => {
    vi.mocked(fetchResources).mockResolvedValue(CLUSTER as never);
    vi.mocked(fetchHelmReleases).mockResolvedValue([
      { name: "grafana", namespace: "default", chart: "grafana-9.4.9", status: "deployed" },
    ] as never);
    useCanvasStore.setState({ nodes: [], edges: [] });
  });

  it("brings in that stack only, with its release card in front", async () => {
    await useCanvasStore.getState().hydrateGraph("grafana");
    const nodes = useCanvasStore.getState().nodes;

    expect(nodes[0].data.kind).toBe("HelmRelease");
    expect(nodes.map(n => n.data.name)).not.toContain("other");
    expect(useCanvasStore.getState().graphName).toBe("grafana");
  });

  it("leaves out Helm's own revision secrets", async () => {
    await useCanvasStore.getState().hydrateGraph("grafana");
    expect(useCanvasStore.getState().nodes.map(n => n.data.name)).not.toContain(
      "sh.helm.release.v1.grafana.v2"
    );
  });

  it("marks what the chart owns, so editing it is refused", async () => {
    await useCanvasStore.getState().hydrateGraph("grafana");
    const service = useCanvasStore.getState().nodes.find(n => n.data.kind === "Service")!;
    expect(service.data.origin).toBe("helm");
    expect(service.data.chartOf).toBe(useCanvasStore.getState().nodes[0].id);
  });
});
