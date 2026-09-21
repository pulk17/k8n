import dagre from "dagre";
import { Node, Edge } from "reactflow";

const nodeWidth = 280;
// A card is its header plus a couple of rows of detail. Dagre spaces ranks and
// neighbours around the size it is given, so an 80px guess — half the real
// thing — packed imported graphs tight enough for cards to touch.
const nodeHeight = 150;

export function layoutGraph(nodes: Node[], edges: Edge[]) {
  // Create a fresh graph per call to avoid stale state leaking between layouts
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: "LR", ranksep: 120, nodesep: 40 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  return nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });
}

