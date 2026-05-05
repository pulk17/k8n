import { Node, Edge } from "reactflow";
import { API_URL } from "./api";

export async function compileGraph(nodes: Node[], edges: Edge[]): Promise<string> {
  const yamlBlocks: string[] = [];

  for (const node of nodes) {
    if (!node.data?.kind || node.data.kind === "HelmRelease") continue;
    
    // For HPA, find the target deployment/statefulset from edges
    let nodeData = { ...node.data };
    if (node.data.kind === "HorizontalPodAutoscaler") {
      // Find outgoing edge to determine target
      const targetEdge = edges.find(e => e.source === node.id);
      if (targetEdge) {
        const targetNode = nodes.find(n => n.id === targetEdge.target);
        if (targetNode && ['Deployment', 'StatefulSet', 'ReplicaSet'].includes(targetNode.data.kind)) {
          nodeData.targetName = targetNode.data.name;
          nodeData.targetKind = targetNode.data.kind;
        }
      }
    }
    
    // Call the backend mapper for each node
    try {
      const res = await fetch(`${API_URL}/api/mapper/${node.data.kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nodeData)
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to compile ${node.data.kind} ${node.data.name}: ${errorText}`);
      }

      const yaml = await res.text();
      if (yaml && yaml.trim()) {
        yamlBlocks.push(yaml.trim());
      }
    } catch (err: any) {
      console.error(err);
      throw new Error(`Compilation error on node ${node.id}: ${err.message}`);
    }
  }

  return yamlBlocks.join("\n---\n");
}
