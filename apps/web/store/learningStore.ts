import { create } from "zustand";

/**
 * How much Kubernetes to explain.
 *
 * The same canvas has to work for someone who has never heard of a pod and for
 * someone who writes operators. Rather than two products, there is one setting:
 * every surface that explains something reads this and decides how far back to
 * start. Nothing is hidden from a beginner and nothing is repeated at an
 * expert — the difference is where the explanation begins.
 */
export type Depth = "new" | "some" | "expert";

export const DEPTHS: { id: Depth; label: string; blurb: string }[] = [
  {
    id: "new",
    label: "New to Kubernetes",
    blurb: "Start from what each object is and why it exists.",
  },
  {
    id: "some",
    label: "I know the basics",
    blurb: "Skip the introductions; keep the traps and the commands.",
  },
  {
    id: "expert",
    label: "I use Kubernetes daily",
    blurb: "Just what k8n does with each object, and the kubectl for it.",
  },
];

const KEY = "k8n_depth";

interface LearningState {
  depth: Depth;
  /** False until the reader has said, which is what triggers the welcome. */
  chosen: boolean;
  setDepth: (depth: Depth) => void;
  /** Reads the saved choice. Called from an effect: this is a static export,
      so touching localStorage while rendering would differ from the prerender. */
  load: () => void;
}

export const useLearningStore = create<LearningState>(set => ({
  depth: "some",
  chosen: false,

  setDepth: depth => {
    try {
      localStorage.setItem(KEY, depth);
    } catch {
      // A browser with storage blocked still gets the setting for this session.
    }
    set({ depth, chosen: true });
  },

  load: () => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "new" || saved === "some" || saved === "expert") {
        set({ depth: saved, chosen: true });
      }
    } catch {
      // Treated as a first visit.
    }
  },
}));

/** Whether a piece of explanation is worth showing at this depth. */
export function showsAt(depth: Depth, section: "intro" | "detail" | "reference"): boolean {
  if (section === "reference") return true; // wiring and kubectl: useful to everyone
  if (depth === "expert") return false;
  if (depth === "some") return section === "detail";
  return true;
}
