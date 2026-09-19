/** Whether release tag `latest` is newer than `current` ("v0.2.10" > "v0.2.9"). */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

const REPO = "pulk17/k8n";
const CACHE_KEY = "k8n_latest_release";
const DAY = 24 * 60 * 60 * 1000;

/**
 * The newest release tag, asked of GitHub at most once a day. Read-only and
 * anonymous: nothing about this install is sent anywhere.
 */
export async function latestRelease(): Promise<string | null> {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cached && Date.now() - cached.at < DAY) return cached.tag;
  } catch {
    // Storage blocked or garbled: just ask.
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!res.ok) return null;
    const tag = (await res.json()).tag_name as string;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ tag, at: Date.now() }));
    } catch {}
    return tag;
  } catch {
    return null;
  }
}
