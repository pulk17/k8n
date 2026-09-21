import { Document, isMap, isPair, isScalar, parseDocument, stringify } from "yaml";

/**
 * A chart's values.yaml, cut into its top-level settings so each can be read
 * and changed on its own, and the user's Custom Values kept as only what they
 * changed.
 *
 * Helm merges the custom values over the chart's defaults, map by map. So a
 * section written back unchanged is dropped from the custom values, a changed
 * one is written whole (a superset of the default is harmless), and removing a
 * default needs an explicit null — leaving a key out keeps the chart's value.
 */

export interface Section {
  key: string;
  /** The author's comment above the key, first paragraph. */
  comment: string;
  /** The default as the chart wrote it, comments and all: "key: …". */
  defaultText: string;
  defaultValue: unknown;
}

/** Top-level settings of a values.yaml, in the author's order. */
export function splitDefaults(valuesYaml: string): Section[] {
  const doc = parseDocument(valuesYaml);
  if (!isMap(doc.contents)) return [];
  const sections: Section[] = [];
  for (const item of doc.contents.items) {
    if (!isPair(item) || !isScalar(item.key)) continue;
    const key = String(item.key.value);
    const start = item.key.range?.[0] ?? 0;
    const end = (item.value as { range?: [number, number, number] } | null)?.range?.[2] ?? item.key.range?.[2] ?? start;
    sections.push({
      key,
      comment: describes(item.key.commentBefore ?? ""),
      defaultText: valuesYaml.slice(start, end).trimEnd(),
      defaultValue: doc.get(key, false) === undefined ? null : toJS(doc, key),
    });
  }
  // Settings the author left commented out at the top level — grafana's
  // "# adminPassword: strongpassword" — are real options that are simply off.
  const known = new Set(sections.map(x => x.key));
  for (const m of valuesYaml.matchAll(/^# ?([A-Za-z_][\w.-]*):( .*)?$/gm)) {
    if (known.has(m[1])) continue;
    known.add(m[1]);
    sections.push({
      key: m[1],
      comment: "Commented out in the chart: off unless you set it.",
      defaultText: `${m[1]}:${m[2] ?? ""}`,
      defaultValue: undefined,
    });
  }
  return sections;
}

/**
 * The comment that describes a key: the last paragraph above it — unless that
 * paragraph is itself a commented-out setting ("# schedulerName: stork") with
 * its own note, which belongs to that setting, not this one.
 */
function describes(commentBefore: string): string {
  const paragraph = commentBefore.split("\n\n").pop()?.trim() ?? "";
  return /^\s*#*\s*[A-Za-z_][\w.-]*:(\s|$)/m.test(paragraph) ? "" : paragraph;
}

function toJS(doc: Document, key: string): unknown {
  return (doc.toJS() as Record<string, unknown>)[key];
}

/** The user's custom values as an object; throws with a readable message. */
export function parseCustom(custom: string): Record<string, unknown> {
  if (!custom.trim()) return {};
  const doc = parseDocument(custom);
  if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
  const value = doc.toJS();
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Custom values must be a map of settings, like `replicas: 2`.");
  }
  return value as Record<string, unknown>;
}

/** Order-independent deep equality for parsed YAML. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return (
    ka.length === kb.length &&
    ka.every(k => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

/** What a section's box shows: the user's version if they have one. */
export function sectionText(section: Section, custom: Record<string, unknown>): string {
  return section.key in custom ? stringify({ [section.key]: custom[section.key] }).trimEnd() : section.defaultText;
}

export type SectionResult = { values: string; error?: undefined } | { values?: undefined; error: string };

/**
 * Writes one section's box back into the custom values. Edge cases:
 * - invalid YAML: an error, and the custom values stay as they were;
 * - a box that defines other keys, or none: refused, it is this key's box;
 * - an empty box, or text equal to the default: the override is removed;
 * - the rest of the custom values, comments included, is left alone.
 */
export function setSection(custom: string, section: Section, text: string): SectionResult {
  let current;
  try {
    current = custom.trim() ? parseDocument(custom) : new Document({});
    if (current.errors.length > 0) throw new Error(current.errors[0].message);
    // Written as a person would, not as { a: 1 }.
    if (isMap(current.contents)) current.contents.flow = false;
  } catch (err) {
    return { error: `Fix the full custom values first: ${(err as Error).message}` };
  }

  let value: unknown;
  if (text.trim()) {
    const doc = parseDocument(text);
    if (doc.errors.length > 0) return { error: doc.errors[0].message.split("\n")[0] };
    const parsed = doc.toJS();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: `Write it as "${section.key}: …"` };
    }
    const keys = Object.keys(parsed);
    if (keys.length !== 1 || keys[0] !== section.key) {
      return { error: `This box is for "${section.key}" only; it defines ${keys.map(k => `"${k}"`).join(", ") || "nothing"}.` };
    }
    value = (parsed as Record<string, unknown>)[section.key];
  }

  if (!text.trim() || sameValue(value, section.defaultValue)) {
    current.delete(section.key);
  } else {
    current.set(section.key, current.createNode(value));
  }
  const out = String(current).trim();
  return { values: out === "{}" ? "" : out + "\n" };
}

/** Sections to show: the chart's, plus any custom keys the chart does not declare. */
export function allSections(defaults: Section[], custom: Record<string, unknown>): Section[] {
  const known = new Set(defaults.map(s => s.key));
  const extra = Object.keys(custom)
    .filter(k => !known.has(k))
    .map(key => ({ key, comment: "Not in the chart's values.yaml — the chart may ignore it.", defaultText: "", defaultValue: undefined }));
  return [...defaults, ...extra];
}
