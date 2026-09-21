import { describe, expect, it } from "vitest";
import { allSections, matches, matchingLines, parseCustom, sameValue, sectionText, setSection, splitDefaults } from "../chartValues";

const DEFAULTS = `# Default values for grafana.
# This is a YAML-formatted file.

replicas: 1

## Use an alternate scheduler, e.g. "stork".
# schedulerName: "stork"

image:
  tag: "12"

## Administrator credentials when not using an existing secret
adminUser: admin
# adminPassword: strongpassword

service:
  enabled: true
  # The type of Service
  type: ClusterIP
  port: 80
`;

describe("chart values", () => {
  const sections = splitDefaults(DEFAULTS);
  const byKey = Object.fromEntries(sections.map(s => [s.key, s]));

  it("splits values.yaml into its top-level settings, comments kept", () => {
    expect(sections.map(s => s.key)).toEqual(["replicas", "image", "adminUser", "service", "schedulerName", "adminPassword"]);
    // The scheduler note belongs to the commented-out schedulerName, not to image.
    expect(byKey.image.comment).toBe("");
    expect(byKey.adminUser.comment).toContain("Administrator credentials");
    expect(byKey.service.defaultText).toContain("# The type of Service");
    expect(byKey.service.defaultValue).toEqual({ enabled: true, type: "ClusterIP", port: 80 });
  });

  it("writes a changed section into the custom values, as block YAML", () => {
    const r = setSection("", byKey.service, "service:\n  enabled: true\n  type: NodePort\n  port: 80");
    expect(r.error).toBeUndefined();
    expect(r.values).toMatch(/^service:\n {2}enabled: true/);
    expect(parseCustom(r.values!)).toEqual({ service: { enabled: true, type: "NodePort", port: 80 } });
  });

  it("drops a section put back to the default, even reordered", () => {
    const changed = setSection("", byKey.service, "service:\n  type: NodePort").values!;
    const back = setSection(changed, byKey.service, "service:\n  port: 80\n  type: ClusterIP\n  enabled: true");
    expect(back.values).toBe("");
  });

  it("treats an emptied box as reset", () => {
    const changed = setSection("", byKey.replicas, "replicas: 3").values!;
    expect(setSection(changed, byKey.replicas, "   ").values).toBe("");
  });

  it("keeps the rest of the custom values, comments and all", () => {
    const custom = "# my notes\nadminPassword: s3cret\n";
    const r = setSection(custom, byKey.replicas, "replicas: 2").values!;
    expect(r).toContain("# my notes");
    expect(parseCustom(r)).toEqual({ adminPassword: "s3cret", replicas: 2 });
  });

  it("refuses invalid YAML and leaves the values alone", () => {
    const r = setSection("replicas: 2\n", byKey.service, "service:\n  type: [unclosed");
    expect(r.error).toBeTruthy();
    expect(r.values).toBeUndefined();
  });

  it("refuses a box that sets a different key", () => {
    expect(setSection("", byKey.service, "replicas: 4").error).toContain('"service" only');
    expect(setSection("", byKey.service, "service: {}\nreplicas: 2").error).toContain('"service" only');
  });

  it("shows the user's version when there is one, the chart's otherwise", () => {
    expect(sectionText(byKey.replicas, {})).toBe("replicas: 1");
    expect(sectionText(byKey.replicas, { replicas: 5 })).toBe("replicas: 5");
  });

  it("offers settings the chart left commented out, such as adminPassword", () => {
    expect(byKey.adminPassword.defaultText).toBe("adminPassword: strongpassword");
    const r = setSection("", byKey.adminPassword, "adminPassword: admin");
    expect(parseCustom(r.values!)).toEqual({ adminPassword: "admin" });
    expect(setSection(r.values!, byKey.adminPassword, "").values).toBe("");
  });

  it("lists custom keys the chart does not declare at all", () => {
    const shown = allSections(sections, parseCustom("somethingNew: 1"));
    expect(shown.map(s => s.key)).toContain("somethingNew");
  });

  it("explains custom values that are not a map", () => {
    expect(() => parseCustom("- a\n- b")).toThrow(/map of settings/);
    expect(parseCustom("")).toEqual({});
  });

  it("compares values regardless of key order", () => {
    expect(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: "1" })).toBe(false);
  });
});

describe("searching a chart's settings", () => {
  const sections = splitDefaults(DEFAULTS);
  const service = sections.find(s => s.key === "service")!;

  it("finds a setting by a key nested inside it", () => {
    expect(matches(service, "clusterip")).toBe(true);
    expect(matchingLines(service, "type")).toEqual(["# The type of Service", "type: ClusterIP"]);
  });

  it("still matches the name and the comment, and nothing else", () => {
    expect(matches(service, "service")).toBe(true);
    expect(matches(service, "ingress")).toBe(false);
    expect(matchingLines(service, "")).toEqual([]);
  });
});
