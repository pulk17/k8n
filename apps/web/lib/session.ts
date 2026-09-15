/**
 * The pairing token, from the browser's side.
 *
 * k8n prints a link with the token in it; opening that link is the whole setup.
 * This module takes the token out of the address bar the moment the app loads,
 * keeps it in localStorage, and puts it on every request afterwards — so the
 * secret is not left sitting in the URL, in history, or in a link someone
 * screenshots.
 *
 * It is stored per origin, which is exactly the property that makes it work as
 * a defence: a page on another site cannot read it, so it cannot make requests
 * k8n will accept, even from the same machine.
 */

const KEY = "k8n_token";

export const TOKEN_HEADER = "X-K8n-Token";

/** Fired when the API says we are not paired, so the UI can ask for a token. */
export const UNAUTHORIZED_EVENT = "k8n:unauthorized";

let token = "";

export function getToken(): string {
  return token;
}

export function setToken(next: string): void {
  token = next.trim();
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage can be blocked; the token still works for this page's lifetime.
  }
}

export function clearToken(): void {
  setToken("");
}

/** Adds the token to a URL, for EventSource — which cannot set headers. */
export function withToken(url: string): string {
  if (!token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
}

/**
 * Takes the token back out of the address bar.
 *
 * This has to run after hydration, not at import: Next restores the URL it
 * rendered with, so a replaceState during module load is undone a moment later
 * and the secret stays on screen.
 */
export function stripTokenFromUrl(): void {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  if (!params.has("t") && !params.has("token")) return;

  params.delete("t");
  params.delete("token");
  const query = params.toString();
  window.history.replaceState(
    {},
    "",
    window.location.pathname + (query ? `?${query}` : "") + window.location.hash
  );
}

export function reportUnauthorized(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }
}

/**
 * Runs once, at import, before anything can make a request: a token in the
 * address bar wins over a stored one, because following a fresh link is how you
 * re-pair after the token is regenerated.
 */
function load(): void {
  if (typeof window === "undefined") return;

  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = (params.get("t") || params.get("token") || "").trim();

    if (fromUrl) {
      setToken(fromUrl);
      return;
    }

    token = localStorage.getItem(KEY) || "";
  } catch {
    token = "";
  }
}

load();
