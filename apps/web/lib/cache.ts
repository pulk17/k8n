/**
 * Remembers the result of a slow call for the life of the page. Rendering a
 * chart or reading its values is a download; switching tabs must not repeat it.
 * A failure is forgotten, so trying again really tries again.
 */
const store = new Map<string, Promise<unknown>>();

export function memo<T>(key: string, fn: () => Promise<T>, refresh = false): Promise<T> {
  if (refresh) store.delete(key);
  let pending = store.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = fn();
    store.set(key, pending);
    pending.catch(() => store.delete(key));
  }
  return pending;
}
