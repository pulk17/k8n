import { isLocalEngine } from "../session";
import { age } from "../constants";
import { defaultName } from "../graph";
import { describe, expect, it } from "vitest";
import { isNewer } from "../version";
import { isClusterDown } from "../api";
import { chartWarnings, imagesIn, renderedObjects } from "../chartChecks";
import { filterCommands } from "../../components/CommandPalette";

describe("isNewer", () => {
  it("compares numerically, not as text", () => {
    expect(isNewer("v0.2.10", "v0.2.9")).toBe(true);
    expect(isNewer("v0.2.9", "v0.2.10")).toBe(false);
  });
  it("handles a missing v and missing parts", () => {
    expect(isNewer("1.0", "v0.9.9")).toBe(true);
    expect(isNewer("v1.0.0", "1.0")).toBe(false);
  });
  it("is false for the same version", () => {
    expect(isNewer("v0.3.0", "v0.3.0")).toBe(false);
  });
});

describe("isClusterDown", () => {
  it("recognises a stopped cluster however it is phrased", () => {
    expect(isClusterDown('Kubernetes cluster unreachable: Get "https://127.0.0.1:51080/version"')).toBe(true);
    expect(
      isClusterDown("dial tcp 127.0.0.1:6443: connectex: No connection could be made because the target machine actively refused it.")
    ).toBe(true);
    expect(isClusterDown("dial tcp 10.0.0.1:443: connect: connection refused")).toBe(true);
    expect(isClusterDown("dial tcp 10.0.0.1:443: i/o timeout")).toBe(true);
  });
  it("leaves ordinary API errors alone", () => {
    expect(isClusterDown('deployments.apps "web" not found')).toBe(false);
    expect(isClusterDown("Forbidden: cannot delete kube-system/coredns")).toBe(false);
  });
});

describe("chart checks", () => {
  it("finds images however they are written", () => {
    const yaml = 'containers:\n  - image: nginx:1.27\n    name: a\n  - name: b\n    image: "docker.io/bitnami/redis:7"\n';
    expect(imagesIn(yaml)).toEqual(["nginx:1.27", "docker.io/bitnami/redis:7"]);
  });
  it("warns about Bitnami images", () => {
    expect(chartWarnings("image: bitnami/postgresql:16")).toHaveLength(1);
  });
  it("does not warn about the legacy mirror or anything else", () => {
    expect(chartWarnings("image: bitnamilegacy/postgresql:16\nimage: grafana/grafana:11")).toEqual([]);
  });
});

describe("filterCommands", () => {
  const commands = [
    { label: "Add Deployment", hint: "to the canvas", run: () => {} },
    { label: "Add Service", hint: "to the canvas", run: () => {} },
    { label: "Review & apply", hint: "compile, diff, dry-run, apply", run: () => {} },
  ];
  it("matches every word, anywhere in label or hint", () => {
    expect(filterCommands(commands, "add dep").map(c => c.label)).toEqual(["Add Deployment"]);
    expect(filterCommands(commands, "diff").map(c => c.label)).toEqual(["Review & apply"]);
  });
  it("shows everything for an empty query", () => {
    expect(filterCommands(commands, "  ")).toHaveLength(3);
  });
  it("is case-insensitive", () => {
    expect(filterCommands(commands, "SERVICE")).toHaveLength(1);
  });
});

describe("splitting a rendered chart", () => {
  const rendered = `---
# Source: grafana/templates/serviceaccount.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: grafana
  namespace: default
---
# Source: grafana/templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: grafana
spec:
  template:
    spec:
      containers:
        - name: grafana
          image: grafana/grafana:12
`;

  it("gives one entry per object, with where it came from", () => {
    const objects = renderedObjects(rendered);
    expect(objects.map(o => `${o.kind}/${o.name}`)).toEqual(["ServiceAccount/grafana", "Deployment/grafana"]);
    expect(objects[1].source).toBe("grafana/templates/deployment.yaml");
    // The object's own name, not the container's.
    expect(objects[1].yaml).toContain("image: grafana/grafana:12");
  });

  it("copes with a manifest that is only comments or empty", () => {
    expect(renderedObjects("")).toEqual([]);
    expect(renderedObjects("---\n---\n")).toEqual([]);
  });
});

describe("naming a new card", () => {
  it("uses kubectl's short name and the next free number", () => {
    expect(defaultName("HorizontalPodAutoscaler", [])).toBe("hpa-1");
    expect(defaultName("Deployment", ["deployment-1", "deployment-3"])).toBe("deployment-2");
  });
});

describe("age", () => {
  const now = Date.parse("2026-09-21T12:00:00Z");
  it("reads like kubectl's AGE column", () => {
    expect(age("2026-09-21T11:59:15Z", now)).toBe("45s");
    expect(age("2026-09-21T11:48:00Z", now)).toBe("12m");
    expect(age("2026-09-19T12:00:00Z", now)).toBe("2d");
  });
  it("leaves what it cannot read alone", () => {
    expect(age("soon", now)).toBe("soon");
    expect(age(undefined, now)).toBe("");
  });
});

describe("which engine the hosted page may talk to", () => {
  it("is only ever this machine", () => {
    expect(isLocalEngine("http://127.0.0.1:8090")).toBe(true);
    expect(isLocalEngine("http://localhost:8080")).toBe(true);
    expect(isLocalEngine("http://[::1]:8080")).toBe(true);
    expect(isLocalEngine("https://attacker.example")).toBe(false);
    expect(isLocalEngine("http://localhost.attacker.example")).toBe(false);
    expect(isLocalEngine("javascript:alert(1)")).toBe(false);
    expect(isLocalEngine("not a url")).toBe(false);
  });
});
