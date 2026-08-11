import { Edge, Node } from "reactflow";
import { makeEdge, makeNode, nodeId } from "./graph";

/**
 * Sketches a workflow from a Dockerfile.
 *
 * This is a starting point, not a translation: a Dockerfile says nothing about
 * replicas, health checks or how the app should be reached. FROM names the app,
 * EXPOSE gives a port, and ENV lines become a ConfigMap.
 */
export function dockerfileToGraph(content: string): { nodes: Node[]; edges: Edge[]; name: string } {
  let appName = "app";
  let port = 80;
  const env: string[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    const from = trimmed.match(/^FROM\s+(\S+)/i);
    if (from) appName = from[1].split("/").pop()!.split(":")[0];

    const expose = trimmed.match(/^EXPOSE\s+(\d+)/i);
    if (expose) port = parseInt(expose[1], 10);

    // Both `ENV KEY=value` and the legacy `ENV KEY value` form.
    const envLine = trimmed.match(/^ENV\s+(\w+)[=\s]+(.+)$/i);
    if (envLine) env.push(`${envLine[1]}=${envLine[2].trim()}`);
  }

  const deployment = makeNode(nodeId("Deployment"), "Deployment", appName, "default", {
    replicas: 2,
    image: `${appName}:latest`,
    containerPort: port,
  });

  const service = makeNode(nodeId("Service"), "Service", `${appName}-service`, "default", {
    port,
    targetPort: port,
    serviceType: "ClusterIP",
  });

  const nodes = [deployment, service];
  const edges = [makeEdge(service, deployment)];

  if (env.length > 0) {
    const config = makeNode(nodeId("ConfigMap"), "ConfigMap", `${appName}-config`, "default", {
      configData: env.join("\n"),
    });
    nodes.push(config);
    edges.push(makeEdge(config, deployment));
  }

  return { nodes, edges, name: `${appName} (from Dockerfile)` };
}
