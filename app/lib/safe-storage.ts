/**
 * localStorage wrappers that tolerate ephemeral storage: missing in SSR,
 * throwing on access (private mode, embedded webviews, quota exceeded),
 * or wiped between visits. Reads return null and writes no-op on failure.
 */

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readStorage(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Storage full or forbidden — treat as ephemeral.
  }
}

export function removeStorage(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing to remove from, or forbidden — ignore.
  }
}
