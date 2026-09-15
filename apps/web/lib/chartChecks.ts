/**
 * Checks run against the YAML a chart renders, before anything is installed.
 *
 * A chart is opaque: you drop it, it installs, and the first thing you learn
 * about the images it chose is a pod stuck in ImagePullBackOff. These read the
 * rendered manifest and say what the pods would have told you ten minutes
 * later.
 */

export interface ChartWarning {
  title: string;
  /** What is wrong, in the same voice as the graph checks. */
  why: string;
  fix: string;
  /** The images the warning is about, for showing the evidence. */
  images?: string[];
}

// Matches `image: repo/name:tag` in a rendered manifest, quoted or not, whether
// it sits under a container or in a list item.
const IMAGE_LINE = /^\s*-?\s*image:\s*["']?([^"'\s]+)["']?\s*$/gm;

/** Every distinct container image the manifest asks for, in order. */
export function imagesIn(yaml: string): string[] {
  const found = new Set<string>();
  for (const match of yaml.matchAll(IMAGE_LINE)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/** `bitnami/x`, but not `bitnamilegacy/x`, at the start or after a registry. */
const BITNAMI = /(^|\/)bitnami\//;

export function chartWarnings(yaml: string): ChartWarning[] {
  const warnings: ChartWarning[] = [];
  const bitnami = imagesIn(yaml).filter(image => BITNAMI.test(image));

  if (bitnami.length > 0) {
    warnings.push({
      title: "These images probably cannot be pulled",
      why:
        "In August 2025 Bitnami moved its free images to the bitnamilegacy repository and " +
        "kept only a short list of current tags under bitnami/. Charts that still point at " +
        "the old path fail with ImagePullBackOff and “not found” once the pods start.",
      fix:
        "In Custom Values, point each image at bitnamilegacy — for example " +
        "image.repository: bitnamilegacy/prometheus — and add " +
        "global.security.allowInsecureImages: true, which Bitnami charts require before " +
        "they will accept a repository they did not publish. Pinning an older chart " +
        "version, or using a chart from another publisher, works too.",
      images: bitnami,
    });
  }

  return warnings;
}
