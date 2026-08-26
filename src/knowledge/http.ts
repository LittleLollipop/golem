/**
 * Shared HTTP helpers for live KnowledgeSource adapters (req_l05_knowledge_trajectory).
 *
 * All helpers fail SOFT: network error / timeout / non-200 → null (never throw),
 * so a source degrades gracefully (the tracker then learns nothing that day).
 */

/** fetch with AbortController timeout. Returns null on any failure. */
async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  headers: Record<string, string>,
): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { headers, signal: ctrl.signal } as RequestInit);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<T | null> {
  const res = await fetchWithTimeout(fetchImpl, url, timeoutMs, headers);
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchText(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<string | null> {
  const res = await fetchWithTimeout(fetchImpl, url, timeoutMs, headers);
  if (!res || !res.ok) return null;
  try {
    return await res.text();
  } catch {
    return null;
  }
}

/** Fisher–Yates shuffle (mode "random"). Returns a new array. */
export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
