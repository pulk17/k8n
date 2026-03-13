import { Node, Edge } from "reactflow";
import { API_URL } from "./api";

export async function compileGraph(nodes: Node[], edges: Edge[]): Promise<string> {
  const yamlBlocks: string[] = [];

  for (const node of nodes) {
    if (!node.data?.kind || node.data.kind === "HelmRelease") continue;
    
    // Call the backend mapper for each node
    try {
      const res = await fetch(`${API_URL}/api/mapper/${node.data.kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(node.data)
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
