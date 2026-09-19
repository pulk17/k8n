import { describe, expect, it } from "vitest";
import { applyRisks } from "../applyRisks";

describe("applyRisks", () => {
  it("says nothing for an ordinary apply", () => {
    expect(applyRisks("metadata:\n  namespace: default\n", "docker-desktop")).toEqual([]);
  });

  it("flags a context named like production", () => {
    for (const ctx of ["prod", "eks-prod-eu", "gke_team_production", "live-cluster", "arn:aws:eks:x/prd"]) {
      expect(applyRisks("", ctx), ctx).toHaveLength(1);
    }
  });

  it("does not flag names that merely contain the letters", () => {
    for (const ctx of ["product-demo", "reproduce", "delivery", "kind-kind"]) {
      expect(applyRisks("", ctx), ctx).toEqual([]);
    }
  });

  it("flags the cluster's own namespaces, once each", () => {
    const yaml =
      "metadata:\n  namespace: kube-system\n---\nmetadata:\n  namespace: \"kube-system\"\n---\nmetadata:\n  namespace: kube-public\n";
    const risks = applyRisks(yaml);
    expect(risks).toHaveLength(1);
    expect(risks[0]).toContain("kube-system, kube-public");
  });
});
