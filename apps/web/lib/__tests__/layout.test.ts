import { describe, expect, it } from "vitest";
import { Edge, Node } from "reactflow";
import { layoutGraph } from "../layout";

/** A stack as it arrives from a cluster: several objects pointing at one workload. */
const nodes: Node[] = ["release", "svc", "cm", "secret", "sa", "deploy"].map(id => ({
  id,
  position: { x: 0, y: 0 },
  data: {},
}));
const edges: Edge[] = ["svc", "cm", "secret", "sa"].map(id => ({ id: `${id}-deploy`, source: id, target: "deploy" }));

describe("layoutGraph", () => {
  it("never puts two cards on top of each other", () => {
    const placed = layoutGraph(nodes, edges);
    const boxes = placed.map(n => ({ x: n.position.x, y: n.position.y, w: 280, h: 150 }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${placed[i].id} overlaps ${placed[j].id}`).toBe(false);
      }
    }
  });

  it("puts what feeds a workload to its left", () => {
    const placed = layoutGraph(nodes, edges);
    const at = (id: string) => placed.find(n => n.id === id)!.position;
    expect(at("svc").x).toBeLessThan(at("deploy").x);
  });
});
