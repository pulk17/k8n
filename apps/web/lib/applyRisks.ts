/**
 * Reasons to stop and ask before an apply. Empty means just go.
 *
 * A context named like production, or a manifest reaching into the cluster's
 * own namespaces, is where a misclick costs the most — and where k8n, being a
 * friendly canvas, most needs to not feel like a toy.
 */
export function applyRisks(yaml: string, context?: string): string[] {
  const risks: string[] = [];
  if (context && /(^|[-_.@/])(prod|production|live|prd)([-_.@/]|$)/i.test(context)) {
    risks.push(`You are connected to "${context}", which looks like a production cluster.`);
  }
  const system = new Set<string>();
  for (const m of yaml.matchAll(/^\s*namespace:\s*["']?(kube-[\w-]+)/gm)) system.add(m[1]);
  if (system.size > 0) {
    risks.push(`This changes the cluster's own namespace${system.size > 1 ? "s" : ""}: ${[...system].join(", ")}.`);
  }
  return risks;
}
